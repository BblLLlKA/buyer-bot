import type { MyContext, MyConversation } from "../types";
import { searchUserProfiles } from "../services/userService";
import { collectAndQueueDomainCampaignPairs } from "./domainCampaignConversation";
import { describeUser } from "../utils/userLabel";
import { logger } from "../config/logger";

const log = logger.child({ module: "conversation:domain-campaign" });

export const DOMAIN_CAMPAIGN_FOR_USER_CONVERSATION_NAME = "domainCampaignForUserConversation";

const MAX_SEARCH_ATTEMPTS = 5;

/**
 * Admin-only: looks up another user by username or Telegram ID, then runs
 * the same campaign/domain collection flow as domainCampaignConversation —
 * but using *that user's* aioUserUUID. All progress messages still land in
 * the admin's own chat.
 */
export async function domainCampaignForUserConversation(
  conversation: MyConversation,
  ctx: MyContext,
): Promise<void> {
  const adminTelegramId = ctx.from?.id;
  log.debug({ adminTelegramId }, "Started domainCampaignForUserConversation");

  await ctx.reply(
    "Введите username или Telegram ID пользователя, для которого подключаем домены к кампаниям.\n\n" +
      "Отправьте /cancel для отмены.",
  );

  let attempts = 0;

  while (true) {
    const current = await conversation.waitFor("message:text");
    const query = current.message.text.trim();

    if (query === "/cancel") {
      log.debug({ adminTelegramId }, "Cancelled domainCampaignForUserConversation");
      await current.reply("Отменено.");
      return;
    }

    const results = await conversation.external(() => searchUserProfiles(query));
    log.debug({ adminTelegramId, query, resultCount: results.length }, "Target-user search for domain linking");

    if (results.length === 0) {
      attempts += 1;
      if (attempts >= MAX_SEARCH_ATTEMPTS) {
        log.debug({ adminTelegramId, attempts }, "Target-user search retries exhausted");
        await current.reply("Слишком много неудачных попыток. Начните заново из главного меню.");
        return;
      }
      await current.reply("Пользователь не найден. Попробуйте снова или отправьте /cancel:");
      continue;
    }

    if (results.length > 1) {
      const list = results.map((u) => `• ${describeUser(u)} (ID ${u.telegramId})`).join("\n");
      await current.reply(`Найдено несколько пользователей, уточните запрос:\n${list}`);
      continue;
    }

    const target = results[0];
    if (!target.aioUserUUID) {
      attempts += 1;
      if (attempts >= MAX_SEARCH_ATTEMPTS) {
        log.debug({ adminTelegramId, attempts }, "Target-user search retries exhausted (no AIO UUID)");
        await current.reply("Слишком много неудачных попыток. Начните заново из главного меню.");
        return;
      }
      await current.reply(
        `У пользователя ${describeUser(target)} ещё не задан AIO UUID — сначала завершите его регистрацию. ` +
          `Введите другого пользователя или отправьте /cancel:`,
      );
      continue;
    }

    log.debug(
      { adminTelegramId, targetTelegramId: target.telegramId },
      "Resolved target user, continuing to domain-campaign collection",
    );
    await ctx.reply(`Подключаем домены к кампаниям от имени ${describeUser(target)}.`);
    await collectAndQueueDomainCampaignPairs(conversation, ctx, target.aioUserUUID);
    return;
  }
}
