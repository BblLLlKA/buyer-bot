import type { NextFunction } from "grammy";
import type { MyContext } from "../types";
import { logger } from "../config/logger";

const log = logger.child({ module: "middleware:auth" });

export async function adminOnly(ctx: MyContext, next: NextFunction): Promise<void> {
  if (ctx.auth?.role !== "admin") {
    log.warn(
      { telegramId: ctx.from?.id, role: ctx.auth?.role, data: ctx.callbackQuery?.data },
      "Blocked non-admin from an admin-only route",
    );
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Доступно только администраторам.", show_alert: true }).catch(() => {});
    } else {
      await ctx.reply("Доступно только администраторам.");
    }
    return;
  }
  return next();
}
