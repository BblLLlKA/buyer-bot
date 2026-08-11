import { GrammyError } from "grammy";
import type { InlineKeyboard } from "grammy";
import type { MyContext } from "../types";

export interface RenderedScreen {
  text: string;
  keyboard: InlineKeyboard;
}

const IGNORABLE_EDIT_ERRORS = ["message is not modified"];
const FALLBACK_TO_NEW_MESSAGE_ERRORS = [
  "message to edit not found",
  "message can't be edited",
  "query is too old",
];

/**
 * Renders a screen by editing the message behind the current callback query
 * whenever possible, and only falls back to sending a brand new message when
 * editing is impossible (no message to edit, message too old/deleted, etc).
 */
export async function renderScreen(ctx: MyContext, screen: RenderedScreen): Promise<void> {
  const { text, keyboard } = screen;

  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "HTML" });
      return;
    } catch (err) {
      if (err instanceof GrammyError) {
        const description = err.description ?? "";
        if (IGNORABLE_EDIT_ERRORS.some((m) => description.includes(m))) {
          return;
        }
        if (FALLBACK_TO_NEW_MESSAGE_ERRORS.some((m) => description.includes(m))) {
          await ctx.reply(text, { reply_markup: keyboard, parse_mode: "HTML" });
          return;
        }
      }
      throw err;
    }
  }

  await ctx.reply(text, { reply_markup: keyboard, parse_mode: "HTML" });
}
