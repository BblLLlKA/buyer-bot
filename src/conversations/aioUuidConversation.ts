import type { MyContext, MyConversation } from "../types";
import { setAioUuid } from "../services/userService";
import { renderMainMenu } from "../screens/mainMenu";
import { renderScreen } from "../utils/safeEdit";
import { isValidUuid, normalizeUuid } from "../utils/uuid";
import { logger } from "../config/logger";

const log = logger.child({ module: "conversation:aio-uuid" });

export const AIO_UUID_CONVERSATION_NAME = "aioUuidConversation";

/**
 * Collects and saves the AIO UUID for an admin's own account, entered
 * directly from their own /start handler (same chat, so entering the
 * conversation there is straightforward). Buyers no longer go through this
 * conversation — an approving admin enters the applicant's UUID on their
 * behalf instead, see aioUuidForUserConversation.
 */
export async function aioUuidConversation(conversation: MyConversation, ctx: MyContext): Promise<void> {
  log.debug({ telegramId: ctx.from?.id }, "Started aioUuidConversation (own account)");
  await ctx.reply("🔑 Введите ваш AIO UUID, чтобы завершить регистрацию.");

  let current = await conversation.waitFor("message:text");
  while (!isValidUuid(current.message.text)) {
    await current.reply("❌ Неверный формат UUID. Попробуйте снова:");
    current = await conversation.waitFor("message:text");
  }

  const uuid = normalizeUuid(current.message.text);
  const telegramId = current.from!.id;
  // Only pull out the plain string we actually need — conversation.external
  // clones its return value via structuredClone, which can't handle a
  // Mongoose document (or its DocumentArray fields) directly.
  const savedRole = await conversation.external(async () => {
    const doc = await setAioUuid(telegramId, uuid);
    return doc?.role ?? null;
  });

  log.info({ telegramId }, "AIO UUID saved (own account)");
  await current.reply("✅ AIO UUID сохранён.");
  await renderScreen(current, renderMainMenu(savedRole ?? "admin", true));
}
