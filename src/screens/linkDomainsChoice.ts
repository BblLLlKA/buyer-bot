import { InlineKeyboard } from "grammy";
import type { RenderedScreen } from "../utils/safeEdit";

/** Admin-only intermediate screen: link domains for themselves or for another user. */
export function renderLinkDomainsChoice(): RenderedScreen {
  const text = ["🔗 <b>Подключить домен к кампании</b>", "", "За кого выполняем привязку?"].join("\n");
  const keyboard = new InlineKeyboard()
    .text("🙋 За себя", "admin:linkDomains:self")
    .row()
    .text("👤 За другого пользователя", "admin:linkDomains:other")
    .row()
    .text("⬅️ Назад", "menu:main");
  return { text, keyboard };
}
