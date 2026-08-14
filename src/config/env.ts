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

function parseFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

export const env = {
  botToken: required("BOT_TOKEN"),
  mongoUri: process.env.MONGO_URI ?? "mongodb://localhost:27017/buyer-bot",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  primaryAdminIds: parseAdminIds(process.env.ADMIN_IDS),
  logLevel: process.env.LOG_LEVEL ?? "info",
  aioApiBaseUrl: process.env.AIO_API_BASE_URL ?? "https://app.aio.tech/api/v1",
  aioApiToken: process.env.AIO_API_TOKEN ?? "",
  // Fixed identifiers required by the AIO Domain\CreateManually action when
  // purchasing domains — distinct from the DEFAULT_MONITORING_USER_UUID
  // constant in aioApi.ts, which is only used by the (unrelated) Domain\Edit
  // action for campaign linking.
  aioDnsProviderUuid: process.env.AIO_DNS_PROVIDER_UUID ?? "",
  aioMonitoringUserUuid: process.env.AIO_MONITORING_USER_UUID ?? "",

  namecheap: {
    apiUser: process.env.NAMECHEAP_USERNAME ?? "",
    apiKey: process.env.NAMECHEAP_API_KEY ?? "",
    userName: process.env.NAMECHEAP_USERNAME ?? "",
    clientIp: process.env.NAMECHEAP_CLIENT_IP ?? "",
    endpoint: "https://api.namecheap.com/xml.response",
    contact: {
      firstName: process.env.NAMECHEAP_CONTACT_FIRST_NAME ?? "",
      lastName: process.env.NAMECHEAP_CONTACT_LAST_NAME ?? "",
      organizationName: process.env.NAMECHEAP_CONTACT_ORGANIZATION ?? "",
      address1: process.env.NAMECHEAP_CONTACT_ADDRESS1 ?? "",
      city: process.env.NAMECHEAP_CONTACT_CITY ?? "",
      stateProvince: process.env.NAMECHEAP_CONTACT_STATE ?? "",
      postalCode: process.env.NAMECHEAP_CONTACT_POSTAL_CODE ?? "",
      country: process.env.NAMECHEAP_CONTACT_COUNTRY ?? "",
      phone: process.env.NAMECHEAP_CONTACT_PHONE ?? "",
      emailAddress: process.env.NAMECHEAP_CONTACT_EMAIL ?? "",
    },
  },

  cloudflare: {
    apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
    apiBaseUrl: process.env.CLOUDFLARE_API_BASE_URL ?? "https://api.cloudflare.com/client/v4",
  },

  maxDomainsPerRequest: (() => {
    const value = Number.parseInt(process.env.MAX_DOMAINS_PER_REQUEST ?? "", 10);
    return Number.isInteger(value) && value > 0 ? value : 50;
  })(),

  domainPrices: {
    com: parseFloatEnv("DOMAIN_PRICE_COM", 12),
    info: parseFloatEnv("DOMAIN_PRICE_INFO", 15),
    org: parseFloatEnv("DOMAIN_PRICE_ORG", 14),
    default: parseFloatEnv("DOMAIN_PRICE_DEFAULT", 15),
  },
};
