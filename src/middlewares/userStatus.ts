import type { NextFunction } from "grammy";
import type { MyContext } from "../types";
import { getUserByTelegramId } from "../services/userService";
import { logger } from "../config/logger";

const log = logger.child({ module: "middleware:auth" });

/**
 * Resolves the caller's DB record on every update and gates access:
 * unregistered users are pointed at /start, pending/awaiting_uuid/rejected/
 * banned users are blocked from everything else. Only approved users get
 * `ctx.auth` populated and pass through — awaiting_uuid is now handled
 * entirely on the approving admin's side (see aioUuidForUserConversation),
 * the applicant has nothing to do while it's in that state.
 */
export async function userStatusMiddleware(ctx: MyContext, next: NextFunction): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return next();

  const isStartCommand = ctx.message?.text === "/start";
  if (isStartCommand) return next();

  const user = await getUserByTelegramId(telegramId);

  if (!user) {
    log.debug({ telegramId }, "Unregistered user blocked, pointed at /start");
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Начните с команды /start.", show_alert: true }).catch(() => {});
    } else {
      await ctx.reply("Пожалуйста, начните с команды /start.");
    }
    return;
  }

  ctx.auth = {
    telegramId: user.telegramId,
    role: user.role,
    status: user.status,
    aioUserUUID: user.aioUserUUID ?? null,
  };

  if (user.status === "awaiting_uuid") {
    log.debug({ telegramId }, "Blocked update: user is awaiting_uuid");
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Заявка подтверждена и обрабатывается администратором.", show_alert: true }).catch(() => {});
    } else {
      await ctx.reply("✅ Ваша заявка подтверждена и обрабатывается администратором. Ожидайте.");
    }
    return;
  }

  if (user.status === "banned") {
    log.debug({ telegramId }, "Blocked update: user is banned");
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Вы заблокированы.", show_alert: true }).catch(() => {});
    } else {
      await ctx.reply("🚫 Вы заблокированы и не можете пользоваться ботом.");
    }
    return;
  }

  if (user.status === "pending") {
    log.debug({ telegramId }, "Blocked update: user is pending");
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Ваша заявка ещё на рассмотрении.", show_alert: true }).catch(() => {});
    } else {
      await ctx.reply("⏳ Ваша заявка ещё на рассмотрении.");
    }
    return;
  }

  if (user.status === "rejected") {
    log.debug({ telegramId }, "Blocked update: user is rejected");
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Ваша заявка отклонена.", show_alert: true }).catch(() => {});
    } else {
      await ctx.reply("❌ Ваша заявка была отклонена. Обратитесь к администратору.");
    }
    return;
  }

  log.debug({ telegramId, role: user.role }, "Update authorized");
  return next();
}
