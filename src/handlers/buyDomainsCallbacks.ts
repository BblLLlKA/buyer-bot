import type { MyContext } from "../types";
import { BUY_DOMAINS_CONVERSATION_NAME } from "../conversations/buyDomainsConversation";
import { logger } from "../config/logger";

const log = logger.child({ module: "handler:buy-domains" });

/**
 * Admin-only entry point for domain purchasing. The route is also gated by
 * the `adminOnly` middleware in bot.ts (defense-in-depth, same as the other
 * admin-only routes), even though the menu button itself is only ever shown
 * to admins (see buildMainMenuKeyboard).
 */
export async function menuBuyDomainsHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const aioUserUUID = ctx.auth?.aioUserUUID;
  if (!aioUserUUID) {
    log.warn({ adminId: ctx.from?.id }, "Blocked domain purchase — admin has no AIO UUID yet");
    await ctx.reply("Сначала завершите регистрацию, указав AIO UUID.");
    return;
  }

  log.debug({ adminId: ctx.from?.id }, "Entering buy-domains conversation");
  await ctx.conversation.enter(BUY_DOMAINS_CONVERSATION_NAME, aioUserUUID);
}
