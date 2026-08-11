import { InlineKeyboard } from "grammy";
import type { UserHydrated } from "../services/userService";

export function buildUserCardKeyboard(user: UserHydrated): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (user.status === "banned") {
    keyboard.text("✅ Разбанить", `admin:unban:${user.telegramId}`).row();
  } else {
    keyboard.text("🚫 Забанить", `admin:ban:${user.telegramId}`).row();
  }

  const roleLabel = user.role === "admin" ? "👤 Сделать buyer" : "🛠 Сделать admin";
  keyboard.text(roleLabel, `admin:role:${user.telegramId}`).row();

  keyboard.text("⬅️ Назад", "admin:back");
  return keyboard;
}
