import { InlineKeyboard } from "grammy";
import type { MyContext, AdminUserFilter } from "../types";
import { renderAdminUserList } from "../screens/adminUserList";
import { renderScreen } from "../utils/safeEdit";

const KNOWN_FILTERS: AdminUserFilter[] = ["all", "pending", "approved", "banned"];

function parseFilter(raw: string | undefined): AdminUserFilter {
  return KNOWN_FILTERS.includes(raw as AdminUserFilter) ? (raw as AdminUserFilter) : "all";
}

export async function adminListHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const data = ctx.callbackQuery?.data ?? "";
  const [, , filterRaw, pageRaw] = data.split(":");
  const filter = parseFilter(filterRaw);
  const page = Math.max(0, Number(pageRaw) || 0);

  ctx.session.adminPanel = { filter, page };
  await renderScreen(ctx, await renderAdminUserList(filter, page));
}

export async function adminBackHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const { filter, page } = ctx.session.adminPanel;
  await renderScreen(ctx, await renderAdminUserList(filter, page));
}

export async function adminSearchPromptHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();
  ctx.session.awaitingSearch = true;
  await renderScreen(ctx, {
    text: "🔎 Введите Telegram ID или username пользователя для поиска.",
    keyboard: new InlineKeyboard().text("⬅️ Назад", "admin:back"),
  });
}
