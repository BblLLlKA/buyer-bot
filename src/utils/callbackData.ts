/** Parses the numeric telegramId out of a `prefix:action:<id>` callback_data string. */
export function parseTargetId(data: string): number | null {
  const id = Number(data.split(":")[2]);
  return Number.isInteger(id) ? id : null;
}
