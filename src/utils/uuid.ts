const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value.trim());
}

/** Trims and lowercases a UUID so it compares equal regardless of the case it was typed in. */
export function normalizeUuid(value: string): string {
  return value.trim().toLowerCase();
}
