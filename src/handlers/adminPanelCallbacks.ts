import { InlineKeyboard } from "grammy";
import type { MyContext, AdminUserFilter } from "../types";
import { renderAdminUserList } from "../screens/adminUserList";
import { renderScreen } from "../utils/safeEdit";
import { logger } from "../config/logger";

const log = logger.child({ module: "handler:admin-panel" });

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
  log.debug({ adminId: ctx.from?.id, filter, page }, "Admin viewed user list");
  await renderScreen(ctx, await renderAdminUserList(filter, page));
}

export async function adminBackHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const { filter, page } = ctx.session.adminPanel;
  log.debug({ adminId: ctx.from?.id, filter, page }, "Admin navigated back to user list");
  await renderScreen(ctx, await renderAdminUserList(filter, page));
}

export async function adminSearchPromptHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();
  ctx.session.awaitingSearch = true;
  log.debug({ adminId: ctx.from?.id }, "Admin opened user search prompt");
  await renderScreen(ctx, {
    text: "🔎 Введите Telegram ID или username пользователя для поиска.",
    keyboard: new InlineKeyboard().text("⬅️ Назад", "admin:back"),
  });
}
