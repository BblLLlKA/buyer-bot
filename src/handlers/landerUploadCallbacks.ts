import type { MyContext } from "../types";
import { LANDER_UPLOAD_CONVERSATION_NAME } from "../conversations/landerUploadConversation";
import { logger } from "../config/logger";

const log = logger.child({ module: "handler:lander-upload" });

/**
 * Admin-only entry point for bulk lander uploads. The route is also gated by
 * the `adminOnly` middleware in bot.ts (defense-in-depth, same as the other
 * admin-only routes), even though the menu button itself is only ever shown
 * to admins (see buildMainMenuKeyboard).
 */
export async function menuLanderUploadHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();
  log.debug({ adminId: ctx.from?.id }, "Entering lander-upload conversation");
  await ctx.conversation.enter(LANDER_UPLOAD_CONVERSATION_NAME);
}
