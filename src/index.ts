import { connectMongo } from "./db/mongo";
import { logger } from "./config/logger";
import { env } from "./config/env";
import { ensurePrimaryAdmins } from "./services/adminService";
import { createBot } from "./bot/bot";
import { createNotifyWorker } from "./queues/notifyWorker";
import { createDomainCampaignWorker } from "./queues/domainCampaignWorker";
import { createDomainPurchaseWorker } from "./queues/domainPurchaseWorker";

const log = logger.child({ module: "startup" });

// Last-resort safety net: anything that escapes bot.catch() (grammY) and
// every try/catch in services/workers — e.g. a rejected promise nobody
// awaited, or a genuine programmer error — would otherwise crash the
// process with a bare stack trace on stderr instead of a structured log
// line. Logged, then the process exits so it can be restarted clean
// (continuing after an uncaughtException runs in an undefined state).
process.on("unhandledRejection", (reason) => {
  log.error({ err: reason }, "Unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  log.error({ err }, "Uncaught exception — exiting");
  process.exit(1);
});

async function main() {
  log.info(
    {
      logLevel: env.logLevel,
      primaryAdminCount: env.primaryAdminIds.length,
      aioApiBaseUrl: env.aioApiBaseUrl,
      aioApiTokenConfigured: Boolean(env.aioApiToken),
      namecheapConfigured: Boolean(env.namecheap.apiUser && env.namecheap.apiKey),
      maxDomainsPerRequest: env.maxDomainsPerRequest,
    },
    "Starting buyer-bot",
  );

  await connectMongo();
  await ensurePrimaryAdmins();

  const bot = createBot();
  const notifyWorker = createNotifyWorker(bot.api);
  const domainCampaignWorker = createDomainCampaignWorker(bot.api);
  const domainPurchaseWorker = createDomainPurchaseWorker(bot.api);

  notifyWorker.on("failed", (job, err) => {
    log.error({ err, jobId: job?.id }, "Admin notify job failed");
  });
  domainCampaignWorker.on("failed", (job, err) => {
    log.error({ err, jobId: job?.id }, "Domain-campaign link job failed");
  });
  domainPurchaseWorker.on("failed", (job, err) => {
    log.error({ err, jobId: job?.id }, "Domain-purchase job failed");
  });

  const shutdown = async () => {
    log.info("Shutting down...");
    await Promise.allSettled([
      bot.stop(),
      notifyWorker.close(),
      domainCampaignWorker.close(),
      domainPurchaseWorker.close(),
    ]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await bot.start({
    onStart: (info) => log.info({ username: info.username }, "Bot started"),
  });
}

main().catch((err) => {
  log.error({ err }, "Fatal error during startup");
  process.exit(1);
});
