import { Queue } from "bullmq";
import { bullRedis } from "../db/redis";
import { logger } from "../config/logger";

const log = logger.child({ module: "queue" });

export const DOMAIN_PURCHASE_QUEUE = "domain-purchase";

export interface DomainPurchaseJobData {
  domain: string;
  ip: string;
  telegramId: number;
  aioUserUUID: string;
  chatId: number;
  messageId: number;
  // Local estimate from DOMAIN_PRICE_* config, used only to fail fast in the
  // worker's Namecheap-balance pre-check before attempting a purchase — the
  // real balance and charge are Namecheap's, not tracked by this bot.
  price: number;
  // Set once the Namecheap purchase has succeeded, so a retry after a later
  // technical failure (AIO lookup/create) doesn't buy the domain a second
  // time — see domainPurchaseWorker.ts.
  purchased?: boolean;
  // Set once the domain has been added to Cloudflare and its assigned
  // nameservers have been written back to Namecheap, so a retry after a
  // later technical failure (AIO lookup/create) doesn't redo the
  // Cloudflare/Namecheap DNS step — see domainPurchaseWorker.ts.
  nameservers?: string[];
}

export const domainPurchaseQueue = new Queue<DomainPurchaseJobData>(DOMAIN_PURCHASE_QUEUE, {
  connection: bullRedis,
  defaultJobOptions: {
    // Only network/API failures reach here as thrown errors (see the
    // worker) — business rejections like "insufficient balance" or "domain
    // taken" resolve the job successfully instead, so they're never retried.
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 50,
  },
});

export function enqueueDomainPurchase(data: DomainPurchaseJobData) {
  log.info(
    { category: "billing", domain: data.domain, ip: data.ip, price: data.price, telegramId: data.telegramId },
    "Enqueuing domain-purchase job (estimated price reserved for pre-check)",
  );
  return domainPurchaseQueue.add("purchase-domain", data);
}
