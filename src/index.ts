import { connectMongo } from "./db/mongo";
import { logger } from "./config/logger";
import { ensurePrimaryAdmins } from "./services/adminService";
import { createBot } from "./bot/bot";
import { createNotifyWorker } from "./queues/notifyWorker";
import { createDomainCampaignWorker } from "./queues/domainCampaignWorker";

async function main() {
  await connectMongo();
  await ensurePrimaryAdmins();

  const bot = createBot();
  const notifyWorker = createNotifyWorker(bot.api);
  const domainCampaignWorker = createDomainCampaignWorker(bot.api);

  notifyWorker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "Admin notify job failed");
  });
  domainCampaignWorker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "Domain-campaign link job failed");
  });

  const shutdown = async () => {
    logger.info("Shutting down...");
    await Promise.allSettled([bot.stop(), notifyWorker.close(), domainCampaignWorker.close()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await bot.start({
    onStart: (info) => logger.info({ username: info.username }, "Bot started"),
  });
}

main().catch((err) => {
  logger.error({ err }, "Fatal error during startup");
  process.exit(1);
});
