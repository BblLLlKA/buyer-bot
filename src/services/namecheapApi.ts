import xml2js from "xml2js";
import { env } from "../config/env";
import { logger } from "../config/logger";

const log = logger.child({ module: "service:namecheapApi" });

/**
 * Namecheap client, ported from support-bot's services/namecheap.service.js
 * (same auth params, XML response shape, contact-field mechanic). Simplified
 * for this project's style: no internal retry/circuit-breaker layer —
 * network failures just throw and are retried at the BullMQ job level (see
 * domainPurchaseWorker.ts), same as aioApi.ts. WhoisGuard is intentionally
 * never enabled (see purchaseDomain).
 */

/**
 * Business-level Namecheap error (e.g. domain already taken, invalid
 * contact data) — thrown separately from network/HTTP failures so callers
 * can treat it as final (no retry) instead of a technical failure.
 */
export class NamecheapApiError extends Error {}

type NamecheapRequestParams = Record<string, string | number | undefined>;

async function namecheapRequest(command: string, params: NamecheapRequestParams = {}): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({
    ApiUser: env.namecheap.apiUser,
    ApiKey: env.namecheap.apiKey,
    UserName: env.namecheap.userName,
    ClientIp: env.namecheap.clientIp,
    Command: command,
  });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }

  const url = `${env.namecheap.endpoint}?${query.toString()}`;
  log.debug({ command }, "Namecheap API request");
  const startedAt = Date.now();

  let res: Response;
  try {
    // Connection: close avoids reusing a pooled keep-alive socket that
    // Namecheap's server already closed on its end — without it, undici's
    // fetch occasionally throws "fetch failed: other side closed" on a
    // stale connection, which otherwise just costs a wasted BullMQ retry.
    res = await fetch(url, { headers: { Connection: "close" } });
  } catch (err) {
    log.error({ err, command, durationMs: Date.now() - startedAt }, "Namecheap API request failed (network error)");
    throw err;
  }

  const raw = await res.text();
  const durationMs = Date.now() - startedAt;

  if (!res.ok) {
    log.error({ command, status: res.status, durationMs }, "Namecheap API returned a non-OK HTTP status");
    throw new Error(`Namecheap API ${command} failed with status ${res.status}`);
  }

  const parsed = await xml2js.parseStringPromise(raw, { explicitArray: false, mergeAttrs: false });
  const apiResponse = parsed?.ApiResponse as
    | { $?: { Status?: string }; Errors?: { Error?: unknown }; CommandResponse?: Record<string, unknown> }
    | undefined;

  if (!apiResponse) {
    throw new Error("Invalid Namecheap response");
  }

  if (apiResponse.$?.Status === "ERROR") {
    const errors = apiResponse.Errors?.Error;
    const message = Array.isArray(errors)
      ? errors.map((e) => (e as { _?: string })._ ?? String(e)).join(", ")
      : ((errors as { _?: string } | undefined)?._ ?? (errors as string | undefined) ?? "Unknown Namecheap API error");
    log.warn({ command, message, durationMs }, "Namecheap API returned a business error");
    throw new NamecheapApiError(message);
  }

  log.debug({ command, durationMs }, "Namecheap API response OK");
  return apiResponse as Record<string, unknown>;
}

/** Splits a domain into Namecheap's SLD/TLD params (e.g. "example.com" -> { SLD: "example", TLD: "com" }). */
function parseDomain(domain: string): { SLD: string; TLD: string } {
  const parts = domain.split(".");
  if (parts.length < 2) {
    throw new Error(`Invalid domain: ${domain}`);
  }
  return { SLD: parts.slice(0, -1).join("."), TLD: parts.slice(-1)[0] };
}

/** Purchases a domain. WhoisGuard is never enabled (no WGEnabled param sent). */
export async function purchaseDomain(domain: string): Promise<void> {
  const contact = env.namecheap.contact;
  if (!contact.emailAddress) {
    throw new Error("Namecheap contact is not configured (NAMECHEAP_CONTACT_* env vars)");
  }

  const contactFields: Record<string, string> = {
    FirstName: contact.firstName,
    LastName: contact.lastName,
    OrganizationName: contact.organizationName,
    Address1: contact.address1,
    City: contact.city,
    StateProvince: contact.stateProvince,
    PostalCode: contact.postalCode,
    Country: contact.country,
    Phone: contact.phone,
    EmailAddress: contact.emailAddress,
  };

  const params: NamecheapRequestParams = { DomainName: domain, Years: 1 };
  for (const role of ["Registrant", "Tech", "Admin", "AuxBilling"]) {
    for (const [field, value] of Object.entries(contactFields)) {
      params[`${role}${field}`] = value;
    }
  }

  await namecheapRequest("namecheap.domains.create", params);
}

/** Points a domain at a custom set of nameservers (e.g. the ones Cloudflare assigned its zone). */
export async function setCustomDns(domain: string, nameservers: string[]): Promise<void> {
  const { SLD, TLD } = parseDomain(domain);
  await namecheapRequest("namecheap.domains.dns.setCustom", {
    SLD,
    TLD,
    Nameservers: nameservers.join(","),
  });
}

interface UserGetBalancesResult {
  $?: Record<string, string>;
}

function parseAvailableBalance(result: UserGetBalancesResult | undefined): number {
  const attrs = result?.$ ?? {};
  for (const raw of [attrs.AvailableBalance, attrs.AccountBalance, attrs.Balance]) {
    if (raw === undefined) continue;
    const value = Number.parseFloat(String(raw).replace(/[^\d.-]/g, ""));
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

/**
 * Queries Namecheap's actual account balance (namecheap.users.getBalances).
 * This is the one real, shared balance domain purchases draw from — there is
 * no separate per-admin balance in this bot.
 */
export async function getAvailableBalance(): Promise<number> {
  const apiResponse = await namecheapRequest("namecheap.users.getBalances");
  const commandResponse = apiResponse.CommandResponse as
    | { UserGetBalancesResult?: UserGetBalancesResult }
    | undefined;
  const balance = parseAvailableBalance(commandResponse?.UserGetBalancesResult);
  log.debug({ category: "billing", availableBalance: balance }, "Queried Namecheap account balance");
  return balance;
}
