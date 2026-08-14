import { env } from "../config/env";
import { logger } from "../config/logger";

const log = logger.child({ module: "service:aioApi" });

// Fixed monitoring-user UUID required by the AIO Domain\Edit action; not
// specific to any of our users (the per-user identity is `launcher` inside
// default_query below), so it's kept as a constant rather than per-call input.
const DEFAULT_MONITORING_USER_UUID = "f6c44cd9-1bf5-4406-826a-69fea3d27e9a";

interface AioTableSearchRequest {
  request: {
    [table: string]: {
      table: string;
      page: number;
      limit: number;
      search: string;
      sort_key: string;
      sort_direction: string;
      analytics_position: number;
      filters: unknown[];
      dates: unknown[];
      hide_empty_metrics: boolean;
      hide_bots: boolean;
      unwrap_tree: boolean;
      hide_trash: boolean;
      event_time_attribution: boolean;
      back_fix_attribution: boolean;
      metric_filters: unknown[];
      metric_definition: null;
      metric_definitions: unknown[];
    };
  };
}

async function aioRequest<T>(path: string, body: unknown): Promise<T> {
  const url = `${env.aioApiBaseUrl}${path}`;
  log.debug({ url, body }, "AIO API request");
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `token=${env.aioApiToken}`,
        // Avoids reusing a pooled keep-alive socket the server already
        // closed — see the same fix in namecheapApi.ts for the failure mode.
        Connection: "close",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    log.error({ err, url, durationMs: Date.now() - startedAt }, "AIO API request failed (network error)");
    throw err;
  }

  const raw = await res.text();
  let json: unknown = raw;
  try {
    json = raw ? JSON.parse(raw) : undefined;
  } catch {
    // leave json as the raw text; caller-side parsing below will just find nothing
  }

  const durationMs = Date.now() - startedAt;

  if (!res.ok) {
    log.error({ url, status: res.status, response: json, durationMs }, "AIO API returned a non-OK status");
    throw new Error(`AIO API ${path} failed with status ${res.status}`);
  }

  log.debug({ url, response: json, durationMs }, "AIO API response");
  return json as T;
}

function tableSearchBody(table: string, search: string): AioTableSearchRequest {
  return {
    request: {
      [table]: {
        table,
        page: 1,
        limit: 50,
        search,
        sort_key: "",
        sort_direction: "asc",
        analytics_position: 1,
        filters: [],
        dates: [],
        hide_empty_metrics: false,
        hide_bots: true,
        unwrap_tree: false,
        hide_trash: true,
        event_time_attribution: false,
        back_fix_attribution: false,
        metric_filters: [],
        metric_definition: null,
        metric_definitions: [],
      },
    },
  };
}

function extractRows(json: unknown, table: string): Record<string, unknown>[] {
  const rows = (json as Record<string, { response?: { rows?: unknown } } | undefined>)?.[table]?.response?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

export interface CampaignRow {
  // AIO can legitimately return these as null (e.g. a campaign with no
  // detected traffic source yet) — callers must check before using .uuid.
  owner: { uuid: string } | null;
  _identity: { uuid: string } | null;
  detectedSource: { uuid: string } | null;
}

export async function findCampaignById(campaignId: string): Promise<CampaignRow | null> {
  const json = await aioRequest<unknown>("/tables/data", tableSearchBody("MTK\\Campaigns", campaignId));
  const rows = extractRows(json, "MTK\\Campaigns");
  return rows.length > 0 ? (rows[0] as unknown as CampaignRow) : null;
}

export interface DomainRow {
  domain: { uuid: string } | null;
}

export async function findDomainByName(domain: string): Promise<DomainRow | null> {
  const json = await aioRequest<unknown>("/tables/data", tableSearchBody("MTK\\Domains", domain));
  const rows = extractRows(json, "MTK\\Domains");
  return rows.length > 0 ? (rows[0] as unknown as DomainRow) : null;
}

export interface LinkDomainToCampaignParams {
  domainUuid: string;
  campaignUuid: string;
  sourceUuid: string;
  launcherUuid: string;
}

interface DomainEditResponse {
  messages?: { type: number; title: string; message: string; data: unknown }[];
  primary?: string;
}

export async function linkDomainToCampaign(params: LinkDomainToCampaignParams): Promise<boolean> {
  const defaultQuery = JSON.stringify([
    {
      mode: "path",
      path: "/",
      query: {
        cuuid: params.campaignUuid,
        suuid: params.sourceUuid,
        launcher: params.launcherUuid,
      },
    },
  ]);

  const body = {
    action: "Domain\\Edit",
    repository: "Eloquent\\DomainRepository",
    arguments: {
      description: "",
      tags: [],
      monitoring_user_uuid: DEFAULT_MONITORING_USER_UUID,
      distribution_uuid: null,
      settings: JSON.stringify({ robots: { allow: false } }),
      default_query: defaultQuery,
    },
    uuids: [params.domainUuid],
  };

  const json = await aioRequest<DomainEditResponse>("/actions/process", body);
  return json.messages?.[0]?.message === "Domain Edited" || Boolean(json.primary);
}

export interface ServerRow {
  server: { uuid: string } | null;
}

/** Looks up an AIO server by IP; returns its UUID, or null if none matches. */
export async function findServerByIp(ip: string): Promise<string | null> {
  const json = await aioRequest<unknown>("/tables/data", tableSearchBody("MTK\\Settings\\Servers", ip));
  const rows = extractRows(json, "MTK\\Settings\\Servers");
  const server = (rows[0] as unknown as ServerRow | undefined)?.server;
  return server?.uuid ?? null;
}

interface DomainCreateManuallyResponse {
  messages?: { type: number; title: string; message: string; data: unknown }[];
  primary?: string;
  validation_errors?: Record<string, string[]>;
}

export type CreateDomainManuallyResult = { success: true } | { success: false; error: string };

/**
 * Registers an already-purchased domain in AIO against a server. Unlike
 * every other AIO call here, this action's real request is multipart
 * form-data rather than JSON, so it doesn't go through aioRequest().
 */
export async function createDomainManually(params: { domain: string; serverUuid: string }): Promise<CreateDomainManuallyResult> {
  const form = new FormData();
  form.append("action", "Domain\\CreateManually");
  form.append("repository", "Eloquent\\DomainRepository");
  form.append("arguments[server_uuids][0]", params.serverUuid);
  form.append("arguments[dns_provider_uuid]", env.aioDnsProviderUuid);
  form.append("arguments[monitoring_user_uuid]", env.aioMonitoringUserUuid);
  form.append("arguments[settings]", JSON.stringify({ robots: { allow: false } }));
  form.append("arguments[domain_url]", params.domain);

  const url = `${env.aioApiBaseUrl}/actions/process`;
  log.debug({ url, domain: params.domain }, "AIO API request (Domain\\CreateManually)");
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Cookie: `token=${env.aioApiToken}`, Connection: "close" },
      body: form,
    });
  } catch (err) {
    log.error({ err, url, durationMs: Date.now() - startedAt }, "AIO API request failed (network error)");
    throw err;
  }

  const raw = await res.text();
  let json: unknown = raw;
  try {
    json = raw ? JSON.parse(raw) : undefined;
  } catch {
    // leave json as raw text
  }

  const durationMs = Date.now() - startedAt;

  if (!res.ok) {
    log.error({ url, status: res.status, response: json, durationMs }, "AIO API returned a non-OK status");
    throw new Error(`AIO API /actions/process failed with status ${res.status}`);
  }

  log.debug({ url, response: json, durationMs }, "AIO API response");
  const parsed = json as DomainCreateManuallyResponse;

  if (parsed.validation_errors) {
    const [firstField] = Object.keys(parsed.validation_errors);
    const error = firstField ? parsed.validation_errors[firstField][0] : "Ошибка валидации AIO";
    return { success: false, error };
  }

  const success = parsed.messages?.[0]?.message === "Domain Edited" || Boolean(parsed.primary);
  return success ? { success: true } : { success: false, error: "AIO не подтвердил добавление домена" };
}

// --- Lander (whitepage) bulk upload -----------------------------------
//
// Four-step flow used by landerUploadWorker.ts: create a multipart upload
// slot, upload the zip archive to it in one or more parts, complete the
// upload (which lands the file in AIO's object storage), then create the
// lander itself pointing at that file's URL.

interface CreateMultipartUploadResponse {
  key: string;
  upload_id: string;
  part_size: number;
  min_part_bytes: number;
  max_bytes: number;
}

export interface CreateMultipartUploadResult {
  key: string;
  uploadId: string;
  partSize: number;
  minPartBytes: number;
  maxBytes: number;
}

export async function createMultipartUpload(params: { name: string; contentType: string }): Promise<CreateMultipartUploadResult> {
  const json = await aioRequest<CreateMultipartUploadResponse>("/actions/file/multipart/create", {
    content_type: params.contentType,
    name: params.name,
  });
  return {
    key: json.key,
    uploadId: json.upload_id,
    partSize: json.part_size,
    minPartBytes: json.min_part_bytes,
    maxBytes: json.max_bytes,
  };
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

interface UploadPartResponse {
  part_number: number;
  etag: string;
}

/**
 * Uploads one part of a multipart upload. Unlike the other AIO calls here
 * (JSON via aioRequest, or multipart/form-data), this one's body is the raw
 * binary chunk itself with the upload's coordinates passed as query params —
 * so, like createDomainManually, it doesn't go through aioRequest().
 */
export async function uploadPart(params: {
  key: string;
  uploadId: string;
  partNumber: number;
  contentType: string;
  body: Buffer;
}): Promise<UploadedPart> {
  const query = new URLSearchParams({
    key: params.key,
    upload_id: params.uploadId,
    part_number: String(params.partNumber),
    "ngsw-bypass": "true",
  });
  const url = `${env.aioApiBaseUrl}/actions/file/multipart/part?${query.toString()}`;
  log.debug({ url, partNumber: params.partNumber, bytes: params.body.byteLength }, "AIO API request (multipart part upload)");
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": params.contentType,
        Cookie: `token=${env.aioApiToken}`,
        Connection: "close",
      },
      body: params.body,
    });
  } catch (err) {
    log.error({ err, url, partNumber: params.partNumber, durationMs: Date.now() - startedAt }, "AIO API request failed (network error)");
    throw err;
  }

  const raw = await res.text();
  let json: unknown = raw;
  try {
    json = raw ? JSON.parse(raw) : undefined;
  } catch {
    // leave json as raw text
  }

  const durationMs = Date.now() - startedAt;

  if (!res.ok) {
    log.error({ url, status: res.status, response: json, partNumber: params.partNumber, durationMs }, "AIO API returned a non-OK status");
    throw new Error(`AIO API multipart/part (part ${params.partNumber}) failed with status ${res.status}`);
  }

  log.debug({ url, durationMs, partNumber: params.partNumber }, "AIO API response (multipart part upload)");
  const parsed = json as UploadPartResponse;
  return { partNumber: parsed.part_number, etag: parsed.etag };
}

export async function completeMultipartUpload(params: {
  key: string;
  uploadId: string;
  name: string;
  parts: UploadedPart[];
}): Promise<void> {
  await aioRequest("/actions/file/multipart/complete", {
    key: params.key,
    upload_id: params.uploadId,
    name: params.name,
    parts: params.parts.map((p) => ({ part_number: p.partNumber, etag: p.etag })),
  });
}

/** Builds the public URL of a completed multipart upload from its storage key. */
export function buildZipUrl(key: string): string {
  return `${env.aioStorageBaseUrl}/${key}`;
}

interface LanderUploadResponse {
  messages?: { type: number; title: string; message: string; data: unknown }[];
  primary?: string;
  validation_errors?: Record<string, string[]>;
}

export type CreateLanderResult = { success: true; landerUuid: string } | { success: false; error: string };

/**
 * Creates a lander (whitepage) in AIO from an already-uploaded zip archive.
 * Like createDomainManually, the real request is multipart/form-data.
 * `lander_template_uuid`/`lander_type_uuid` are fixed AIO identifiers (env
 * config), not per-user values.
 */
export async function createLander(params: { name: string; zipUrl: string }): Promise<CreateLanderResult> {
  const form = new FormData();
  form.append("action", "Lander\\Upload");
  form.append("repository", "Eloquent\\LanderRepository");
  form.append("arguments[name]", params.name);
  form.append("arguments[lander_template_uuid]", env.aioLanderTemplateUuid);
  form.append("arguments[lander_type_uuid]", env.aioLanderTypeUuid);
  form.append("arguments[type_structure_settings]", "{}");
  form.append("arguments[countries]", "");
  form.append("arguments[languages]", "");
  form.append("arguments[zip_url]", params.zipUrl);

  const url = `${env.aioApiBaseUrl}/actions/process`;
  log.debug({ url, name: params.name }, "AIO API request (Lander\\Upload)");
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Cookie: `token=${env.aioApiToken}`, Connection: "close" },
      body: form,
    });
  } catch (err) {
    log.error({ err, url, durationMs: Date.now() - startedAt }, "AIO API request failed (network error)");
    throw err;
  }

  const raw = await res.text();
  let json: unknown = raw;
  try {
    json = raw ? JSON.parse(raw) : undefined;
  } catch {
    // leave json as raw text
  }

  const durationMs = Date.now() - startedAt;

  if (!res.ok) {
    log.error({ url, status: res.status, response: json, durationMs }, "AIO API returned a non-OK status");
    throw new Error(`AIO API /actions/process failed with status ${res.status}`);
  }

  log.debug({ url, response: json, durationMs }, "AIO API response");
  const parsed = json as LanderUploadResponse;

  if (parsed.validation_errors) {
    const [firstField] = Object.keys(parsed.validation_errors);
    const error = firstField ? parsed.validation_errors[firstField][0] : "Ошибка валидации AIO";
    return { success: false, error };
  }

  // AIO's exact success message text for Lander\Upload wasn't available at
  // implementation time (unlike Domain\Edit's "Domain Edited") — treated as
  // success whenever there's no validation_errors and the response carries
  // either `primary` or at least one message, mirroring the shape every
  // other AIO action here uses on success. Tighten this to a literal
  // message match (like createDomainManually does) once the real response
  // has been observed.
  const success = Boolean(parsed.primary) || (parsed.messages?.length ?? 0) > 0;
  if (!success) {
    return { success: false, error: "AIO не подтвердил создание вайта" };
  }

  // `primary` is used the same way for the created record's uuid in every
  // other actions/process call here (Domain\Edit, Domain\CreateManually) —
  // assumed to hold the new lander's uuid too, needed for the following
  // Universal\ShareUnshare call. If AIO's actual Lander\Upload response
  // shape puts the uuid somewhere else, this needs to be pointed at that
  // field instead — surfaced as an explicit failure rather than silently
  // sharing with an empty/wrong uuid.
  if (!parsed.primary) {
    return {
      success: false,
      error: "AIO подтвердил создание вайта, но не вернул его uuid — расшарить его не получится",
    };
  }

  return { success: true, landerUuid: parsed.primary };
}

interface ShareUnshareResponse {
  messages?: { type: number; title: string; message: string; data: unknown }[];
  primary?: string;
  validation_errors?: Record<string, string[]>;
}

export type ShareLanderResult = { success: true } | { success: false; error: string };

/**
 * Shares a lander with a user (assigns them as its Owner) — the last step of
 * the bulk lander upload flow, run once per archive right after
 * createLander(). Same multipart/form-data shape as the other
 * actions/process calls that don't go through aioRequest().
 */
export async function shareLander(params: { landerUuid: string; assigneeUuid: string }): Promise<ShareLanderResult> {
  const form = new FormData();
  form.append("action", "Universal\\ShareUnshare");
  form.append("repository", "Eloquent\\LanderRepository");
  form.append("arguments[share][assignments][0][assignee_uuid]", params.assigneeUuid);
  form.append("arguments[share][assignments][0][assignee_type]", "App\\Models\\User");
  form.append("arguments[share][assignments][0][type]", "Owner");
  form.append("uuids[0]", params.landerUuid);

  const url = `${env.aioApiBaseUrl}/actions/process`;
  log.debug({ url, landerUuid: params.landerUuid }, "AIO API request (Universal\\ShareUnshare)");
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Cookie: `token=${env.aioApiToken}`, Connection: "close" },
      body: form,
    });
  } catch (err) {
    log.error({ err, url, durationMs: Date.now() - startedAt }, "AIO API request failed (network error)");
    throw err;
  }

  const raw = await res.text();
  let json: unknown = raw;
  try {
    json = raw ? JSON.parse(raw) : undefined;
  } catch {
    // leave json as raw text
  }

  const durationMs = Date.now() - startedAt;

  if (!res.ok) {
    log.error({ url, status: res.status, response: json, durationMs }, "AIO API returned a non-OK status");
    throw new Error(`AIO API /actions/process failed with status ${res.status}`);
  }

  log.debug({ url, response: json, durationMs }, "AIO API response");
  const parsed = json as ShareUnshareResponse;

  if (parsed.validation_errors) {
    const [firstField] = Object.keys(parsed.validation_errors);
    const error = firstField ? parsed.validation_errors[firstField][0] : "Ошибка валидации AIO";
    return { success: false, error };
  }

  // Same success heuristic as createLander — see the comment there.
  const success = Boolean(parsed.primary) || (parsed.messages?.length ?? 0) > 0;
  return success ? { success: true } : { success: false, error: "AIO не подтвердил шаринг вайта" };
}
