import { Worker, type Job } from "bullmq";
import type { Api } from "grammy";
import { bullRedis } from "../db/redis";
import { logger } from "../config/logger";
import { findCampaignById, findDomainByName, linkDomainToCampaign } from "../services/aioApi";
import { DOMAIN_CAMPAIGN_QUEUE, type DomainCampaignJobData } from "./domainCampaignQueue";

// Used as the campaign's traffic source when AIO hasn't detected one yet
// (campaign.detectedSource === null) — a campaign without a source is common
// enough that we don't want to reject the whole link over it.
const DEFAULT_SOURCE_UUID = "6b34f3df-4762-446e-9c34-b40b72cfa041";

/**
 * Progress is reported by repeatedly editing the single message created for
 * this pair when the job was enqueued — one line per finished step, plus a
 * transient "⏳ ..." line for whatever's currently running.
 */
function createProgressLog(api: Api, chatId: number, messageId: number, header: string) {
  const lines: string[] = [];

  const render = async () => {
    const text = [header, "", ...lines].join("\n");
    try {
      await api.editMessageText(chatId, messageId, text);
    } catch (err) {
      logger.warn({ err, chatId, messageId }, "Failed to update domain-campaign progress message");
    }
  };

  return {
    /** Appends a new (typically transient "⏳") line. */
    async step(line: string) {
      lines.push(line);
      await render();
    },
    /** Replaces the last line (closing out the transient step), optionally starting the next one. */
    async resolve(finalLine: string, nextLine?: string) {
      lines[lines.length - 1] = finalLine;
      if (nextLine) lines.push(nextLine);
      await render();
    },
  };
}

/**
 * Processes one { campaignId, domain } pair end to end. Business rejections
 * (campaign/domain not found, owner mismatch, edit not accepted) resolve the
 * job normally with a final status line — they are not retried. Only
 * unexpected errors (AIO API network/HTTP failures) are thrown, which is
 * what triggers BullMQ's retry/backoff.
 */
export function createDomainCampaignWorker(api: Api): Worker<DomainCampaignJobData> {
  return new Worker<DomainCampaignJobData>(
    DOMAIN_CAMPAIGN_QUEUE,
    async (job: Job<DomainCampaignJobData>) => {
      const { campaignId, domain, aioUserUUID, chatId, messageId } = job.data;
      const header = `🔗 Кампания: ${campaignId} → Домен: ${domain}`;
      const progress = createProgressLog(api, chatId, messageId, header);

      try {
        await progress.step("🔍 Поиск кампании...");
        const campaign = await findCampaignById(campaignId);
        if (!campaign) {
          await progress.resolve("❌ Кампания не найдена");
          return;
        }
        await progress.resolve("✅ Кампания найдена", "🔍 Проверка владельца...");

        // AIO can return these as null — owner/identity missing is a real
        // business rejection, but a missing detectedSource just means AIO
        // hasn't attributed a traffic source to the campaign yet, so we
        // fall back to a default source UUID instead of blocking on it.
        if (!campaign.owner) {
          await progress.resolve("❌ У кампании не определён владелец в AIO");
          return;
        }
        if (campaign.owner.uuid !== aioUserUUID) {
          await progress.resolve("⛔ Кампания принадлежит другому пользователю, пропущено");
          return;
        }
        if (!campaign._identity) {
          await progress.resolve("❌ В AIO не заполнены обязательные данные кампании (identity)");
          return;
        }
        const sourceUuid = campaign.detectedSource?.uuid ?? DEFAULT_SOURCE_UUID;
        await progress.resolve("✅ Владелец совпадает", "🔍 Поиск домена...");

        const domainRow = await findDomainByName(domain);
        if (!domainRow) {
          await progress.resolve("❌ Домен не найден в AIO");
          return;
        }
        if (!domainRow.domain) {
          await progress.resolve("❌ Некорректные данные домена в AIO");
          return;
        }
        await progress.resolve("✅ Домен найден в AIO", "⏳ Привязываем кампанию к домену...");

        const linked = await linkDomainToCampaign({
          domainUuid: domainRow.domain.uuid,
          campaignUuid: campaign._identity.uuid,
          sourceUuid,
          launcherUuid: aioUserUUID,
        });

        if (!linked) {
          await progress.resolve("❌ Ошибка привязки домена к кампании");
          return;
        }
        await progress.resolve("✅ Домен успешно привязан к кампании");
      } catch (err) {
        const attemptsAllowed = job.opts.attempts ?? 1;
        const isLastAttempt = job.attemptsMade + 1 >= attemptsAllowed;
        if (isLastAttempt) {
          await progress.resolve("❌ Техническая ошибка при обращении к AIO API");
        }
        logger.error({ err, campaignId, domain }, "AIO API call failed while linking domain to campaign");
        throw err;
      }
    },
    { connection: bullRedis },
  );
}
