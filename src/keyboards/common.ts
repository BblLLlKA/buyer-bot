import { InlineKeyboard } from "grammy";

export function withBack(keyboard: InlineKeyboard, callbackData: string, label = "⬅️ Назад"): InlineKeyboard {
  return keyboard.row().text(label, callbackData);
}
