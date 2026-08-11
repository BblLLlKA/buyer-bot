import { env } from "../config/env";
import { logger } from "../config/logger";

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
  logger.debug({ url, body }, "AIO API request");

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `token=${env.aioApiToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    logger.error({ err, url }, "AIO API request failed (network error)");
    throw err;
  }

  const raw = await res.text();
  let json: unknown = raw;
  try {
    json = raw ? JSON.parse(raw) : undefined;
  } catch {
    // leave json as the raw text; caller-side parsing below will just find nothing
  }

  if (!res.ok) {
    logger.error({ url, status: res.status, response: json }, "AIO API returned a non-OK status");
    throw new Error(`AIO API ${path} failed with status ${res.status}`);
  }

  logger.debug({ url, response: json }, "AIO API response");
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
