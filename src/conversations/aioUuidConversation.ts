import type { MyContext, MyConversation } from "../types";
import { setAioUuid } from "../services/userService";
import { renderMainMenu } from "../screens/mainMenu";
import { renderScreen } from "../utils/safeEdit";

export const AIO_UUID_CONVERSATION_NAME = "aioUuidConversation";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Collects and saves the AIO UUID for an admin's own account, entered
 * directly from their own /start handler (same chat, so entering the
 * conversation there is straightforward). Buyers no longer go through this
 * conversation — an approving admin enters the applicant's UUID on their
 * behalf instead, see aioUuidForUserConversation.
 */
export async function aioUuidConversation(conversation: MyConversation, ctx: MyContext): Promise<void> {
  await ctx.reply("🔑 Введите ваш AIO UUID, чтобы завершить регистрацию.");

  let current = await conversation.waitFor("message:text");
  while (!UUID_REGEX.test(current.message.text.trim())) {
    await current.reply("❌ Неверный формат UUID. Попробуйте снова:");
    current = await conversation.waitFor("message:text");
  }

  const uuid = current.message.text.trim();
  const telegramId = current.from!.id;
  // Only pull out the plain string we actually need — conversation.external
  // clones its return value via structuredClone, which can't handle a
  // Mongoose document (or its DocumentArray fields) directly.
  const savedRole = await conversation.external(async () => {
    const doc = await setAioUuid(telegramId, uuid);
    return doc?.role ?? null;
  });

  await current.reply("✅ AIO UUID сохранён.");
  await renderScreen(current, renderMainMenu(savedRole ?? "admin", true));
}
