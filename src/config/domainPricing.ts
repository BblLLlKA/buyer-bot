import { env } from "./env";

/** Price of a single domain purchase, based on its TLD. */
export function getDomainPrice(domain: string): number {
  const tld = domain.trim().toLowerCase().split(".").pop() ?? "";
  switch (tld) {
    case "com":
      return env.domainPrices.com;
    case "info":
      return env.domainPrices.info;
    case "org":
      return env.domainPrices.org;
    default:
      return env.domainPrices.default;
  }
}
