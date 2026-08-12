import { Bot } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { env } from "../config/env";
import { logger, withRequestId } from "../config/logger";
import type { MyContext } from "../types";
import { sessionMiddleware } from "../middlewares/session";
import { userStatusMiddleware } from "../middlewares/userStatus";
import { adminOnly } from "../middlewares/adminOnly";
import { startHandler } from "../handlers/start";
import { menuMainHandler, menuAboutHandler, noopHandler } from "../handlers/mainMenuCallbacks";
import {
  menuLinkDomainsHandler,
  linkDomainsSelfHandler,
  linkDomainsOtherHandler,
} from "../handlers/linkDomainsCallbacks";
import { registrationDecisionHandler, registrationApproveHandler } from "../handlers/registrationCallbacks";
import {
  adminListHandler,
  adminBackHandler,
  adminSearchPromptHandler,
} from "../handlers/adminPanelCallbacks";
import {
  adminUserCardHandler,
  adminBanHandler,
  adminUnbanHandler,
  adminToggleRoleHandler,
} from "../handlers/userCardCallbacks";
import { adminSearchTextHandler } from "../handlers/searchCallbacks";
import { aioUuidConversation, AIO_UUID_CONVERSATION_NAME } from "../conversations/aioUuidConversation";
import {
  aioUuidForUserConversation,
  AIO_UUID_FOR_USER_CONVERSATION_NAME,
} from "../conversations/aioUuidForUserConversation";
import {
  domainCampaignConversation,
  DOMAIN_CAMPAIGN_CONVERSATION_NAME,
} from "../conversations/domainCampaignConversation";
import {
  domainCampaignForUserConversation,
  DOMAIN_CAMPAIGN_FOR_USER_CONVERSATION_NAME,
} from "../conversations/domainCampaignForUserConversation";
import { buyDomainsConversation, BUY_DOMAINS_CONVERSATION_NAME } from "../conversations/buyDomainsConversation";
import { menuBuyDomainsHandler } from "../handlers/buyDomainsCallbacks";

const log = logger.child({ module: "bot" });

export function createBot(): Bot<MyContext> {
  const bot = new Bot<MyContext>(env.botToken);

  // First middleware in the chain — logs every incoming update before any
  // gating (session/userStatus/adminOnly) has a chance to short-circuit it,
  // so nothing is invisible to the logs even when it's blocked downstream.
  // Also establishes the requestId (the update_id itself — already unique,
  // no need to mint a fresh one) that every log line emitted while handling
  // this update picks up automatically via the logger's AsyncLocalStorage
  // mixin, all the way down through conversations/services/workers.
  bot.use(async (ctx, next) => {
    await withRequestId(ctx.update.update_id, async () => {
      log.debug(
        {
          telegramId: ctx.from?.id,
          type: ctx.callbackQuery ? "callback_query" : ctx.message ? "message" : "other",
          data: ctx.callbackQuery?.data,
          text: ctx.message?.text,
        },
        "Incoming update",
      );
      await next();
    });
  });

  bot.use(sessionMiddleware);
  // userStatusMiddleware must run before conversations(): once a
  // conversation is active for a chat, the plugin consumes matching updates
  // itself and never calls next() — so a status check placed after it would
  // never re-run on a banned/rejected user's follow-up messages while they
  // still have a conversation in progress. Every legitimate conversation
  // entry point only fires once the caller is already 'approved', so this
  // ordering doesn't block any real flow — see AUDIT.md 1.1 #1.
  bot.use(userStatusMiddleware);
  bot.use(conversations());
  bot.use(createConversation(aioUuidConversation, AIO_UUID_CONVERSATION_NAME));
  bot.use(createConversation(aioUuidForUserConversation, AIO_UUID_FOR_USER_CONVERSATION_NAME));
  bot.use(createConversation(domainCampaignConversation, DOMAIN_CAMPAIGN_CONVERSATION_NAME));
  bot.use(createConversation(domainCampaignForUserConversation, DOMAIN_CAMPAIGN_FOR_USER_CONVERSATION_NAME));
  bot.use(createConversation(buyDomainsConversation, BUY_DOMAINS_CONVERSATION_NAME));

  bot.command("start", startHandler);

  bot.callbackQuery("menu:main", menuMainHandler);
  bot.callbackQuery("menu:about", menuAboutHandler);
  bot.callbackQuery("menu:linkDomains", menuLinkDomainsHandler);
  bot.callbackQuery("admin:linkDomains:self", adminOnly, linkDomainsSelfHandler);
  bot.callbackQuery("admin:linkDomains:other", adminOnly, linkDomainsOtherHandler);
  bot.callbackQuery("menu:buyDomains", adminOnly, menuBuyDomainsHandler);
  bot.callbackQuery("noop", noopHandler);

  // Admin reacting to a registration card. Restricted to admins as
  // defense-in-depth, even though only admins are ever sent this keyboard.
  bot.callbackQuery(/^reg:approve:\d+$/, adminOnly, registrationApproveHandler);
  bot.callbackQuery(/^reg:reject:\d+$/, adminOnly, registrationDecisionHandler("reject"));
  bot.callbackQuery(/^reg:ban:\d+$/, adminOnly, registrationDecisionHandler("ban"));

  bot.callbackQuery(/^admin:list:\w+:\d+$/, adminOnly, adminListHandler);
  bot.callbackQuery("admin:back", adminOnly, adminBackHandler);
  bot.callbackQuery("admin:search", adminOnly, adminSearchPromptHandler);
  bot.callbackQuery(/^admin:user:\d+$/, adminOnly, adminUserCardHandler);
  bot.callbackQuery(/^admin:ban:\d+$/, adminOnly, adminBanHandler);
  bot.callbackQuery(/^admin:unban:\d+$/, adminOnly, adminUnbanHandler);
  bot.callbackQuery(/^admin:role:\d+$/, adminOnly, adminToggleRoleHandler);

  // The only free-text interaction: admin user search, gated on session.awaitingSearch.
  bot.on("message:text", adminSearchTextHandler);

  bot.catch((err) => {
    log.error({ err: err.error, updateId: err.ctx.update.update_id }, "Unhandled bot error");
  });

  return bot;
}
