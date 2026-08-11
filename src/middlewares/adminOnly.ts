import type { NextFunction } from "grammy";
import type { MyContext } from "../types";

export async function adminOnly(ctx: MyContext, next: NextFunction): Promise<void> {
  if (ctx.auth?.role !== "admin") {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Доступно только администраторам.", show_alert: true }).catch(() => {});
    } else {
      await ctx.reply("Доступно только администраторам.");
    }
    return;
  }
  return next();
}
