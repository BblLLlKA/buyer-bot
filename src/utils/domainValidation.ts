import net from "net";

const DOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const ZONE_REGEX = /^\.[a-z]{2,24}$/i;

export function isValidDomain(value: string): boolean {
  return DOMAIN_REGEX.test(value.trim().toLowerCase());
}

export function isValidIpv4(value: string): boolean {
  return net.isIPv4(value.trim());
}

/** Normalizes a raw zone string (e.g. "net" or ".NET") to ".net", or null if invalid. */
export function normalizeZone(raw: string): string | null {
  const cleaned = raw.trim().toLowerCase();
  const normalized = cleaned.startsWith(".") ? cleaned : `.${cleaned}`;
  return ZONE_REGEX.test(normalized) ? normalized : null;
}

/** Parses a positive integer, or null if invalid. */
export function parsePositiveInt(raw: string): number | null {
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}
