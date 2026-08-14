import { env } from "../config/env";
import { logger } from "../config/logger";

const log = logger.child({ module: "service:cloudflareApi" });

/**
 * Cloudflare client, ported from support-bot's services/cloudflare.service.js
 * (same auth scheme — bearer token, no account ID needed for the /zones
 * endpoints used here — and the same check-then-create idempotency shape via
 * ensureZone). Simplified for this project's style: no internal
 * retry/circuit-breaker layer — network failures just throw and are retried
 * at the BullMQ job level (see domainPurchaseWorker.ts), same as
 * aioApi.ts/namecheapApi.ts.
 */

/**
 * Business-level Cloudflare error (validation failure, zone already exists,
 * etc.) — thrown separately from network/HTTP failures so callers can treat
 * it as final (no retry) instead of a technical failure. Carries Cloudflare's
 * own numeric error code where available, so callers can recognize specific
 * cases (e.g. "zone already exists") without parsing the message text.
 */
export class CloudflareApiError extends Error {
  code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}

// https://developers.cloudflare.com/api/ — "An A, AAAA, CNAME... record with
// that host already exists" isn't relevant here; this is the zone-level
// "already registered" error returned by POST /zones when a zone for the
// domain already exists on the account.
const ZONE_ALREADY_EXISTS_CODE = 1061;

interface CloudflareErrorItem {
  code: number;
  message: string;
}

interface CloudflareEnvelope<T> {
  success: boolean;
  errors?: CloudflareErrorItem[];
  result: T;
}

async function cloudflareRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${env.cloudflare.apiBaseUrl}${path}`;
  log.debug({ url, method }, "Cloudflare API request");
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${env.cloudflare.apiToken}`,
        "Content-Type": "application/json",
        // Same rationale as aioApi.ts/namecheapApi.ts — avoids reusing a
        // pooled keep-alive socket the server already closed.
        Connection: "close",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    log.error({ err, url, durationMs: Date.now() - startedAt }, "Cloudflare API request failed (network error)");
    throw err;
  }

  const raw = await res.text();
  const durationMs = Date.now() - startedAt;

  let envelope: CloudflareEnvelope<T> | undefined;
  try {
    envelope = raw ? JSON.parse(raw) : undefined;
  } catch {
    envelope = undefined;
  }

  // Cloudflare returns a JSON envelope with `success`/`errors` even on 4xx
  // (e.g. validation failures), so the envelope shape — not the HTTP status —
  // is what tells a business rejection apart from a technical failure.
  if (!envelope || typeof envelope.success !== "boolean") {
    log.error({ url, status: res.status, durationMs }, "Cloudflare API returned a non-OK or unparseable response");
    throw new Error(`Cloudflare API ${path} failed with status ${res.status}`);
  }

  if (!envelope.success) {
    const errors = envelope.errors ?? [];
    const message = errors.map((e) => e.message).join(", ") || `Cloudflare API ${path} failed`;
    log.warn({ url, errors, durationMs }, "Cloudflare API returned a business error");
    throw new CloudflareApiError(message, errors[0]?.code);
  }

  log.debug({ url, durationMs }, "Cloudflare API response OK");
  return envelope.result;
}

export interface CloudflareZone {
  id: string;
  name: string;
  name_servers?: string[];
}

export async function findZoneByName(domain: string): Promise<CloudflareZone | null> {
  const query = new URLSearchParams({ name: domain, per_page: "1" });
  const zones = await cloudflareRequest<CloudflareZone[]>("GET", `/zones?${query.toString()}`);
  return zones[0] ?? null;
}

export async function createZone(domain: string): Promise<CloudflareZone> {
  return cloudflareRequest<CloudflareZone>("POST", "/zones", {
    name: domain,
    type: "full",
    jump_start: false,
  });
}

export interface EnsuredZone {
  zoneId: string;
  nameservers: string[];
}

/**
 * Adds `domain` to Cloudflare (find-or-create) and returns the nameservers
 * Cloudflare assigned to its zone. Idempotent by design — safe to call again
 * on a BullMQ retry:
 *  - if a zone for this domain already exists (created on an earlier,
 *    possibly-uncommitted attempt), it's reused instead of erroring;
 *  - if `createZone` itself races with an already-existing zone (the
 *    find-then-create window), the resulting "zone already exists" error is
 *    caught and resolved the same way instead of failing the job.
 */
export async function ensureZoneWithNameservers(domain: string): Promise<EnsuredZone> {
  const existing = await findZoneByName(domain);
  if (existing) {
    log.debug({ domain, zoneId: existing.id }, "Cloudflare zone already exists for this domain, reusing it");
    return { zoneId: existing.id, nameservers: existing.name_servers ?? [] };
  }

  try {
    const zone = await createZone(domain);
    return { zoneId: zone.id, nameservers: zone.name_servers ?? [] };
  } catch (err) {
    if (err instanceof CloudflareApiError && err.code === ZONE_ALREADY_EXISTS_CODE) {
      const zoneAfterRace = await findZoneByName(domain);
      if (zoneAfterRace) {
        log.debug({ domain }, "Cloudflare zone creation raced with an already-existing zone, reusing it");
        return { zoneId: zoneAfterRace.id, nameservers: zoneAfterRace.name_servers ?? [] };
      }
    }
    throw err;
  }
}
