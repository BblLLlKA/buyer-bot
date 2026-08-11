import { InlineKeyboard } from "grammy";
import type { MyContext } from "../types";
import { searchUsers } from "../services/userService";
import { renderUserCard } from "../screens/userCard";
import { renderAdminUserList } from "../screens/adminUserList";

/**
 * The one deliberate exception to "inline buttons only": while
 * session.awaitingSearch is set (via the 🔎 Поиск button) the next free-text
 * message from an admin is treated as a user search query, after which we
 * drop straight back into the inline-button flow.
 */
export async function adminSearchTextHandler(ctx: MyContext): Promise<void> {
  if (ctx.auth?.role !== "admin" || !ctx.session.awaitingSearch) return;

  ctx.session.awaitingSearch = false;
  const query = ctx.message?.text?.trim();
  if (!query) return;

  const results = await searchUsers(query);

  if (results.length === 0) {
    await ctx.reply("Пользователь не найден.");
    const { filter, page } = ctx.session.adminPanel;
    const screen = await renderAdminUserList(filter, page);
    await ctx.reply(screen.text, { reply_markup: screen.keyboard, parse_mode: "HTML" });
    return;
  }

  if (results.length === 1) {
    const screen = renderUserCard(results[0]);
    await ctx.reply(screen.text, { reply_markup: screen.keyboard, parse_mode: "HTML" });
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const u of results) {
    keyboard.text(u.username ? `@${u.username}` : String(u.telegramId), `admin:user:${u.telegramId}`).row();
  }
  keyboard.text("⬅️ Назад", "admin:back");
  await ctx.reply("Найдено несколько пользователей:", { reply_markup: keyboard });
}
