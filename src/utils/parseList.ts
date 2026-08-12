/** Splits free-text input on newlines or commas into a trimmed, non-empty list. */
export function parseList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
