import { InlineKeyboard } from "grammy";
import type { MyContext } from "../types";
import { renderMainMenu } from "../screens/mainMenu";
import { renderScreen } from "../utils/safeEdit";
import { DOMAIN_CAMPAIGN_CONVERSATION_NAME } from "../conversations/domainCampaignConversation";

export async function menuMainHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();
  await renderScreen(ctx, renderMainMenu(ctx.auth!.role, Boolean(ctx.auth!.aioUserUUID)));
}

export async function menuLinkDomainsHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();

  // ctx.conversation.enter() only carries `update`/`api`/`me` into the
  // conversation — custom properties like ctx.auth (set by
  // userStatusMiddleware) don't survive the hop. Read what we need here,
  // on the live outer ctx, and pass it in explicitly as an argument.
  const aioUserUUID = ctx.auth?.aioUserUUID;
  if (!aioUserUUID) {
    await ctx.reply("Сначала завершите регистрацию, указав AIO UUID.");
    return;
  }

  await ctx.conversation.enter(DOMAIN_CAMPAIGN_CONVERSATION_NAME, aioUserUUID);
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
