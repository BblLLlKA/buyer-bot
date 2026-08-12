import type { MyContext } from "../types";
import { renderScreen } from "../utils/safeEdit";
import { renderLinkDomainsChoice } from "../screens/linkDomainsChoice";
import { DOMAIN_CAMPAIGN_CONVERSATION_NAME } from "../conversations/domainCampaignConversation";
import { DOMAIN_CAMPAIGN_FOR_USER_CONVERSATION_NAME } from "../conversations/domainCampaignForUserConversation";
import { logger } from "../config/logger";

const log = logger.child({ module: "handler:link-domains" });

// ctx.conversation.enter() only carries `update`/`api`/`me` into the
// conversation — custom properties like ctx.auth (set by
// userStatusMiddleware) don't survive the hop. Read what we need here, on
// the live outer ctx, and pass it in explicitly as an argument.
async function enterOwnDomainCampaignConversation(ctx: MyContext): Promise<void> {
  const aioUserUUID = ctx.auth?.aioUserUUID;
  if (!aioUserUUID) {
    log.warn({ telegramId: ctx.from?.id }, "Blocked domain-campaign linking — no AIO UUID yet");
    await ctx.reply("Сначала завершите регистрацию, указав AIO UUID.");
    return;
  }
  log.debug({ telegramId: ctx.from?.id }, "Entering domain-campaign conversation (own account)");
  await ctx.conversation.enter(DOMAIN_CAMPAIGN_CONVERSATION_NAME, aioUserUUID);
}

/**
 * Buyers go straight into linking their own domains. Admins get an extra
 * choice screen first, since they can also do this on behalf of someone
 * else (see linkDomainsOtherHandler).
 */
export async function menuLinkDomainsHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();

  if (ctx.auth?.role === "admin") {
    await renderScreen(ctx, renderLinkDomainsChoice());
    return;
  }

  await enterOwnDomainCampaignConversation(ctx);
}

export async function linkDomainsSelfHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();
  await enterOwnDomainCampaignConversation(ctx);
}

export async function linkDomainsOtherHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();
  log.debug({ adminId: ctx.from?.id }, "Entering domain-campaign conversation (on behalf of another user)");
  await ctx.conversation.enter(DOMAIN_CAMPAIGN_FOR_USER_CONVERSATION_NAME);
}
