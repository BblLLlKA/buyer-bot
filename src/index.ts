import { connectMongo } from "./db/mongo";
import { logger } from "./config/logger";
import { env } from "./config/env";
import { ensurePrimaryAdmins } from "./services/adminService";
import { createBot } from "./bot/bot";
import { createNotifyWorker } from "./queues/notifyWorker";
import { createDomainCampaignWorker } from "./queues/domainCampaignWorker";
import { createDomainPurchaseWorker } from "./queues/domainPurchaseWorker";
import { createLanderUploadWorker } from "./queues/landerUploadWorker";
import { cleanupStaleTempFiles } from "./utils/tmpStorage";

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
      cloudflareConfigured: Boolean(env.cloudflare.apiToken),
      landerUploadConfigured: Boolean(env.aioLanderTemplateUuid && env.aioLanderTypeUuid),
      maxDomainsPerRequest: env.maxDomainsPerRequest,
      maxLanderFiles: env.maxLanderFiles,
    },
    "Starting buyer-bot",
  );

  await connectMongo();
  await ensurePrimaryAdmins();

  const bot = createBot();
  const notifyWorker = createNotifyWorker(bot.api);
  const domainCampaignWorker = createDomainCampaignWorker(bot.api);
  const domainPurchaseWorker = createDomainPurchaseWorker(bot.api);
  const landerUploadWorker = createLanderUploadWorker(bot.api);

  notifyWorker.on("failed", (job, err) => {
    log.error({ err, jobId: job?.id }, "Admin notify job failed");
  });
  domainCampaignWorker.on("failed", (job, err) => {
    log.error({ err, jobId: job?.id }, "Domain-campaign link job failed");
  });
  domainPurchaseWorker.on("failed", (job, err) => {
    log.error({ err, jobId: job?.id }, "Domain-purchase job failed");
  });
  landerUploadWorker.on("failed", (job, err) => {
    log.error({ err, jobId: job?.id }, "Lander-upload job failed");
  });

  // Fallback safety net for storage/tmp-uploads/: normal cleanup happens
  // per-job in landerUploadWorker.ts, but a crashed process or a job lost
  // from Redis would otherwise leave its archive on disk forever. Sweeps
  // hourly, removing anything older than 6h (generous — jobs finish in
  // minutes) rather than running on every job.
  const TMP_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
  const TMP_FILE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const tmpCleanupInterval = setInterval(() => {
    cleanupStaleTempFiles(TMP_FILE_MAX_AGE_MS).catch((err) => {
      log.error({ err }, "Stale temp upload cleanup sweep failed");
    });
  }, TMP_CLEANUP_INTERVAL_MS);
  tmpCleanupInterval.unref();

  const shutdown = async () => {
    log.info("Shutting down...");
    clearInterval(tmpCleanupInterval);
    await Promise.allSettled([
      bot.stop(),
      notifyWorker.close(),
      domainCampaignWorker.close(),
      domainPurchaseWorker.close(),
      landerUploadWorker.close(),
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
