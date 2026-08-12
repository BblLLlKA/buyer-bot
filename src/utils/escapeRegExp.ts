/** Escapes regex metacharacters so user input can be used safely inside a MongoDB $regex. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
