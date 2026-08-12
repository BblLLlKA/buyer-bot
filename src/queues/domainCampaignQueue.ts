import { Queue } from "bullmq";
import { bullRedis } from "../db/redis";
import { logger } from "../config/logger";

const log = logger.child({ module: "queue" });

export const DOMAIN_CAMPAIGN_QUEUE = "domain-campaign-linking";

export interface DomainCampaignJobData {
  campaignId: string;
  domain: string;
  aioUserUUID: string;
  chatId: number;
  messageId: number;
}

export const domainCampaignQueue = new Queue<DomainCampaignJobData>(DOMAIN_CAMPAIGN_QUEUE, {
  connection: bullRedis,
  defaultJobOptions: {
    // Only network/API failures reach here as thrown errors (see the
    // worker) — business rejections like "campaign not found" resolve the
    // job successfully instead, so they're never retried.
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 50,
  },
});

export function enqueueDomainCampaignLink(data: DomainCampaignJobData) {
  log.debug({ campaignId: data.campaignId, domain: data.domain }, "Enqueuing domain-campaign link job");
  return domainCampaignQueue.add("link-domain-campaign", data);
}
