import type { MyContext } from "../types";
import { findOrCreateUser } from "../services/userService";
import { enqueueAdminNotification } from "../queues/notifyQueue";
import { renderMainMenu } from "../screens/mainMenu";
import { renderScreen } from "../utils/safeEdit";
import { AIO_UUID_CONVERSATION_NAME } from "../conversations/aioUuidConversation";

export async function startHandler(ctx: MyContext): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const { created, user } = await findOrCreateUser({
    telegramId: from.id,
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
  });

  if (created) {
    await ctx.reply("📝 Заявка отправлена, ожидайте подтверждения администратора.");
    await enqueueAdminNotification({
      telegramId: user.telegramId,
      username: user.username ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      createdAtIso: user.createdAt.toISOString(),
    });
    return;
  }

  switch (user.status) {
    case "pending":
      await ctx.reply("⏳ Ваша заявка ещё на рассмотрении. Пожалуйста, ожидайте.");
      return;
    case "awaiting_uuid":
      // The approving admin enters the AIO UUID on the applicant's behalf
      // (see aioUuidForUserConversation) — there's nothing for the
      // applicant themselves to do here but wait.
      await ctx.reply("✅ Ваша заявка подтверждена и обрабатывается администратором. Ожидайте.");
      return;
    case "rejected":
      await ctx.reply("❌ Ваша заявка была отклонена. Обратитесь к администратору.");
      return;
    case "banned":
      await ctx.reply("🚫 Вы заблокированы и не можете пользоваться ботом.");
      return;
    case "approved":
      if (user.role === "admin" && !user.aioUserUUID) {
        await ctx.conversation.enter(AIO_UUID_CONVERSATION_NAME);
        return;
      }
      await renderScreen(ctx, renderMainMenu(user.role, Boolean(user.aioUserUUID)));
      return;
  }
}
