import { InlineKeyboard } from "grammy";

export function buildRegistrationKeyboard(telegramId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Подтвердить", `reg:approve:${telegramId}`)
    .text("❌ Отклонить", `reg:reject:${telegramId}`)
    .row()
    .text("🚫 Забанить", `reg:ban:${telegramId}`);
}
