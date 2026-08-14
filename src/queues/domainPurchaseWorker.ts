import { Worker, type Job } from "bullmq";
import type { Api } from "grammy";
import { bullRedis } from "../db/redis";
import { logger, withJobId } from "../config/logger";
import { getAvailableBalance, purchaseDomain, setCustomDns, NamecheapApiError } from "../services/namecheapApi";
import { ensureZoneWithNameservers, CloudflareApiError } from "../services/cloudflareApi";
import { findServerByIp, createDomainManually } from "../services/aioApi";
import { createProgressLog } from "../utils/progressLog";
import { DOMAIN_PURCHASE_QUEUE, type DomainPurchaseJobData } from "./domainPurchaseQueue";

const log = logger.child({ module: "worker:domain-purchase" });

/**
 * Processes one domain purchase end to end: Namecheap balance check ->
 * Namecheap purchase -> Cloudflare zone (+ nameservers) -> Namecheap NS
 * update -> AIO server lookup -> AIO domain creation. Business rejections
 * (insufficient balance, domain taken, Cloudflare/NS validation errors,
 * server/validation errors from AIO) resolve the job normally with a final
 * status line — they are not retried. Only unexpected errors (Namecheap/
 * Cloudflare/AIO network or HTTP failures) are thrown, which is what
 * triggers BullMQ's retry/backoff.
 *
 * The balance checked here is Namecheap's own account balance
 * (namecheap.users.getBalances) — a single balance shared across every
 * purchase, not a per-admin figure tracked by this bot. `price` (computed
 * from DOMAIN_PRICE_* config when the job was queued) is only a local
 * estimate used to fail fast before attempting a purchase; the real,
 * authoritative check is Namecheap's own purchase call, which fails with a
 * NamecheapApiError if the account genuinely doesn't have the funds.
 *
 * Once the Namecheap purchase succeeds, `job.data.purchased` is persisted via
 * job.updateData so a retry after a later technical failure doesn't buy the
 * domain a second time. Once Cloudflare + the Namecheap NS update both
 * succeed, `job.data.nameservers` is persisted the same way so a retry
 * doesn't redo that step either — and even without that persisted flag (e.g.
 * a crash right after Cloudflare succeeded but before it was saved),
 * `ensureZoneWithNameservers` is itself idempotent: it looks the zone up
 * before creating one, so re-running it just reuses the existing zone
 * instead of erroring.
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
  const alreadyPurchased = Boolean(job.data.purchased);
  const alreadyConfiguredDns = Boolean(job.data.nameservers?.length);
  log.debug(
    { domain, ip, telegramId, price, purchased: alreadyPurchased, dnsConfigured: alreadyConfiguredDns },
    "Processing domain-purchase job",
  );

  const initialLines: string[] = [];
  if (alreadyPurchased) {
    initialLines.push("✅ Баланс Namecheap достаточен", "✅ Домен куплен в Namecheap");
  }
  if (alreadyConfiguredDns) {
    initialLines.push(
      "✅ Домен добавлен в Cloudflare",
      `✅ NS-серверы обновлены в Namecheap (${job.data.nameservers!.join(", ")})`,
    );
  }
  const header = `🌐 Домен: ${domain}`;
  const progress = createProgressLog(api, chatId, messageId, header, initialLines);

  try {
    if (!alreadyPurchased) {
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
      await progress.resolve("✅ Домен куплен в Namecheap", "☁️ Добавление домена в Cloudflare...");
    } else if (!alreadyConfiguredDns) {
      await progress.step("☁️ Добавление домена в Cloudflare...");
    }

    let nameservers = job.data.nameservers;
    if (!nameservers?.length) {
      try {
        const zone = await ensureZoneWithNameservers(domain);
        nameservers = zone.nameservers;
      } catch (err) {
        if (err instanceof CloudflareApiError) {
          await progress.resolve(
            `❌ Ошибка добавления в Cloudflare: ${err.message}. Домен куплен в Namecheap, но не настроен.`,
          );
          return;
        }
        throw err;
      }

      if (!nameservers.length) {
        log.error({ domain }, "Cloudflare zone created but returned no nameservers");
        await progress.resolve(
          "❌ Cloudflare не вернул NS-серверы для домена. Домен куплен в Namecheap, но не настроен.",
        );
        return;
      }
      await progress.resolve("✅ Домен добавлен в Cloudflare", "🔄 Обновление NS-серверов в Namecheap...");

      try {
        await setCustomDns(domain, nameservers);
      } catch (err) {
        if (err instanceof NamecheapApiError) {
          await progress.resolve(
            `❌ Ошибка обновления NS в Namecheap: ${err.message}. Домен куплен и добавлен в Cloudflare, но NS не обновлены — требуется ручная проверка.`,
          );
          return;
        }
        throw err;
      }

      log.info({ domain, nameservers }, "Namecheap nameservers updated to Cloudflare's");
      await job.updateData({ ...job.data, purchased: true, nameservers });
      await progress.resolve(
        `✅ NS-серверы обновлены в Namecheap (${nameservers.join(", ")})`,
        "🔍 Поиск сервера в AIO...",
      );
    } else {
      await progress.step("🔍 Поиск сервера в AIO...");
    }

    const serverUuid = await findServerByIp(ip);
    if (!serverUuid) {
      await progress.resolve(
        `❌ Сервер с IP ${ip} не найден в AIO. Домен уже куплен и настроен, но не добавлен в AIO — требуется ручное добавление.`,
      );
      return;
    }
    await progress.resolve("✅ Сервер найден в AIO", "➕ Добавление домена в AIO...");

    const result = await createDomainManually({ domain, serverUuid });
    if (!result.success) {
      await progress.resolve(`❌ ${result.error}. Домен куплен и настроен, но не добавлен в AIO.`);
      return;
    }
    await progress.resolve("✅ Домен успешно добавлен в AIO");
  } catch (err) {
    const attemptsAllowed = job.opts.attempts ?? 1;
    const isLastAttempt = job.attemptsMade + 1 >= attemptsAllowed;
    if (isLastAttempt) {
      await progress.resolve("❌ Техническая ошибка при обращении к Namecheap/Cloudflare/AIO API");
    }
    log.error({ err, domain, ip }, "Namecheap/Cloudflare/AIO API call failed while purchasing domain");
    throw err;
  }
}
