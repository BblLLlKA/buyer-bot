import { InlineKeyboard } from "grammy";
import type { UserRole } from "../models/User";

export function buildMainMenuKeyboard(role: UserRole, hasAioUuid: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard().text("ℹ️ О боте", "menu:about");
  // Admins always have their own AIO UUID by the time they reach the main
  // menu (see start.ts), and can additionally link domains on behalf of
  // another user — see the admin-only choice screen behind this button.
  if ((role === "buyer" && hasAioUuid) || role === "admin") {
    keyboard.row().text("🔗 Подключить домен к кампании", "menu:linkDomains");
  }
  if (role === "admin") {
    keyboard.row().text("🛠 Админ-панель", "admin:list:all:0");
  }
  return keyboard;
}
