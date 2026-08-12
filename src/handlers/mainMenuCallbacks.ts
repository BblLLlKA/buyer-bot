import { InlineKeyboard } from "grammy";
import type { MyContext } from "../types";
import { renderMainMenu } from "../screens/mainMenu";
import { renderScreen } from "../utils/safeEdit";
import { logger } from "../config/logger";

const log = logger.child({ module: "handler:main-menu" });

export async function menuMainHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();
  log.debug({ telegramId: ctx.from?.id }, "User opened main menu");
  await renderScreen(ctx, renderMainMenu(ctx.auth!.role, Boolean(ctx.auth!.aioUserUUID)));
}

export async function menuAboutHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();
  await renderScreen(ctx, {
    text: "🤖 <b>О боте</b>\n\nБот управляет заявками на доступ и ролями пользователей.",
    keyboard: new InlineKeyboard().text("⬅️ Назад", "menu:main"),
  });
}

export async function noopHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();
}
