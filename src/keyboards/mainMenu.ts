import { InlineKeyboard } from "grammy";
import type { UserRole } from "../models/User";

export function buildMainMenuKeyboard(role: UserRole, hasAioUuid: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard().text("ℹ️ О боте", "menu:about");
  if (role === "buyer" && hasAioUuid) {
    keyboard.row().text("🔗 Подключить домен к кампании", "menu:linkDomains");
  }
  if (role === "admin") {
    keyboard.row().text("🛠 Админ-панель", "admin:list:all:0");
  }
  return keyboard;
}
