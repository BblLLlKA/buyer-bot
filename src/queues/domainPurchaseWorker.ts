import { Worker, type Job } from "bullmq";
import type { Api } from "grammy";
import { bullRedis } from "../db/redis";
import { logger, withJobId } from "../config/logger";
import { getAvailableBalance, purchaseDomain, NamecheapApiError } from "../services/namecheapApi";
import { findServerByIp, createDomainManually } from "../services/aioApi";
import { createProgressLog } from "../utils/progressLog";
import { DOMAIN_PURCHASE_QUEUE, type DomainPurchaseJobData } from "./domainPurchaseQueue";

const log = logger.child({ module: "worker:domain-purchase" });

/**
 * Processes one domain purchase end to end: Namecheap balance check ->
 * Namecheap purchase -> AIO server lookup -> AIO domain creation. Business
 * rejections (insufficient balance, domain taken, server/validation errors
 * from AIO) resolve the job normally with a final status line — they are not
 * retried. Only unexpected errors (Namecheap/AIO network or HTTP failures)
 * are thrown, which is what triggers BullMQ's retry/backoff.
 *
 * The balance checked here is Namecheap's own account balance
 * (namecheap.users.getBalances) — a single balance shared across every
 * purchase, not a per-admin figure tracked by this bot. `price` (computed
 * from DOMAIN_PRICE_* config when the job was queued) is only a local
 * estimate used to fail fast before attempting a purchase; the real,
 * authoritative check is Namecheap's own purchase call, which fails with a
 * NamecheapApiError if the account genuinely doesn't have the funds.
 *
 * Once the Namecheap purchase succeeds, `job.data.purchased` is persisted
 * via job.updateData so that if a *later* step throws a technical error and
 * BullMQ retries the whole job, we don't buy the domain a second time.
 */
export function createDomainPurchaseWorker(api: Api): Worker<DomainPurchaseJobData> {
  return new Worker<DomainPurchaseJobData>(
    DOMAIN_PURCHASE_QUEUE,
    (job: Job<DomainPurchaseJobData>) => withJobId(job.id ?? "unknown", () => processDomainPurchaseJob(api, job)),
    { connection: bullRedis },
  );
}

async function processDomainPurchaseJob(api: Api, job: Job<DomainPurchaseJobData>): Promise<void> {
  const { domain, ip, telegramId, chatId, messageId, price } = job.data;
  log.debug({ domain, ip, telegramId, price, purchased: Boolean(job.data.purchased) }, "Processing domain-purchase job");
  const header = `🌐 Домен: ${domain}`;
  const progress = createProgressLog(
    api,
    chatId,
    messageId,
    header,
    job.data.purchased ? ["✅ Баланс Namecheap достаточен", "✅ Домен куплен в Namecheap"] : [],
  );

  try {
    if (!job.data.purchased) {
      await progress.step("💳 Проверка баланса Namecheap...");

      let availableBalance: number;
      try {
        availableBalance = await getAvailableBalance();
      } catch (err) {
        if (err instanceof NamecheapApiError) {
          await progress.resolve(`❌ Ошибка проверки баланса Namecheap: ${err.message}`);
          return;
        }
        throw err;
      }

      if (availableBalance < price) {
        log.warn(
          { category: "billing", domain, telegramId, price, availableBalance },
          "Domain purchase rejected — insufficient Namecheap balance",
        );
        await progress.resolve(
          `❌ Недостаточно средств на балансе Namecheap (доступно $${availableBalance.toFixed(2)})`,
        );
        return;
      }
      await progress.resolve(
        `✅ Баланс Namecheap достаточен ($${availableBalance.toFixed(2)})`,
        "🛒 Покупка домена в Namecheap...",
      );

      try {
        await purchaseDomain(domain);
      } catch (err) {
        if (err instanceof NamecheapApiError) {
          await progress.resolve(`❌ Ошибка покупки в Namecheap: ${err.message}`);
          return;
        }
        throw err;
      }

      log.info(
        { category: "billing", domain, telegramId, price, balanceBefore: availableBalance },
        "Domain purchased via Namecheap",
      );
      await job.updateData({ ...job.data, purchased: true });
      await progress.resolve("✅ Домен куплен в Namecheap", "🔍 Поиск сервера в AIO...");
    } else {
      await progress.step("🔍 Поиск сервера в AIO...");
    }

    const serverUuid = await findServerByIp(ip);
    if (!serverUuid) {
      await progress.resolve(
        `❌ Сервер с IP ${ip} не найден в AIO. Домен уже куплен в Namecheap, но не добавлен в AIO — требуется ручное добавление.`,
      );
      return;
    }
    await progress.resolve("✅ Сервер найден в AIO", "➕ Добавление домена в AIO...");

    const result = await createDomainManually({ domain, serverUuid });
    if (!result.success) {
      await progress.resolve(`❌ ${result.error}. Домен куплен в Namecheap, но не добавлен в AIO.`);
      return;
    }
    await progress.resolve("✅ Домен успешно добавлен в AIO");
  } catch (err) {
    const attemptsAllowed = job.opts.attempts ?? 1;
    const isLastAttempt = job.attemptsMade + 1 >= attemptsAllowed;
    if (isLastAttempt) {
      await progress.resolve("❌ Техническая ошибка при обращении к Namecheap/AIO API");
    }
    log.error({ err, domain, ip }, "Namecheap/AIO API call failed while purchasing domain");
    throw err;
  }
}
