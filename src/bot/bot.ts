import { Bot } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { env } from "../config/env";
import { logger } from "../config/logger";
import type { MyContext } from "../types";
import { sessionMiddleware } from "../middlewares/session";
import { userStatusMiddleware } from "../middlewares/userStatus";
import { adminOnly } from "../middlewares/adminOnly";
import { startHandler } from "../handlers/start";
import {
  menuMainHandler,
  menuAboutHandler,
  menuLinkDomainsHandler,
  noopHandler,
} from "../handlers/mainMenuCallbacks";
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

export function createBot(): Bot<MyContext> {
  const bot = new Bot<MyContext>(env.botToken);

  bot.use(sessionMiddleware);
  bot.use(conversations());
  bot.use(createConversation(aioUuidConversation, AIO_UUID_CONVERSATION_NAME));
  bot.use(createConversation(aioUuidForUserConversation, AIO_UUID_FOR_USER_CONVERSATION_NAME));
  bot.use(createConversation(domainCampaignConversation, DOMAIN_CAMPAIGN_CONVERSATION_NAME));

  bot.use(userStatusMiddleware);

  bot.command("start", startHandler);

  bot.callbackQuery("menu:main", menuMainHandler);
  bot.callbackQuery("menu:about", menuAboutHandler);
  bot.callbackQuery("menu:linkDomains", menuLinkDomainsHandler);
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
    logger.error({ err: err.error, updateId: err.ctx.update.update_id }, "Unhandled bot error");
  });

  return bot;
}
