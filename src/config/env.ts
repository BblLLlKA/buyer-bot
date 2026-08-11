import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseAdminIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n));
}

export const env = {
  botToken: required("BOT_TOKEN"),
  mongoUri: process.env.MONGO_URI ?? "mongodb://localhost:27017/buyer-bot",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  primaryAdminIds: parseAdminIds(process.env.ADMIN_IDS),
  logLevel: process.env.LOG_LEVEL ?? "info",
  aioApiBaseUrl: process.env.AIO_API_BASE_URL ?? "https://app.aio.tech/api/v1",
  aioApiToken: process.env.AIO_API_TOKEN ?? "",
};
