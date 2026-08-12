/**
 * Masks a secret-looking string for logging: keeps a few characters on each
 * end so it's still recognizable/diffable in logs, blanks out the middle.
 * Use for values that end up in free text (error messages, URLs) rather than
 * structured log fields — those are covered by the logger's own `redact`
 * config instead (see src/config/logger.ts).
 */
export function maskSensitive(value: string | undefined | null, visible = 4): string {
  if (!value) return "";
  if (value.length <= visible * 2) return "*".repeat(value.length);
  return `${value.slice(0, visible)}${"*".repeat(Math.max(3, value.length - visible * 2))}${value.slice(-visible)}`;
}
