import type { RenderedScreen } from "../utils/safeEdit";
import { buildUserCardKeyboard } from "../keyboards/userCard";
import type { UserHydrated } from "../services/userService";

const STATUS_LABELS: Record<string, string> = {
  pending: "⏳ Ожидает",
  awaiting_uuid: "🔑 Ждёт AIO UUID",
  approved: "✅ Подтверждён",
  rejected: "❌ Отклонён",
  banned: "🚫 Забанен",
};

export function renderUserCard(user: UserHydrated): RenderedScreen {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "—";
  const lines = [
    "👤 <b>Карточка пользователя</b>",
    "",
    `ID: <code>${user.telegramId}</code>`,
    `Username: ${user.username ? "@" + user.username : "—"}`,
    `Имя: ${name}`,
    `Роль: ${user.role}`,
    `Статус: ${STATUS_LABELS[user.status] ?? user.status}`,
    `AIO UUID: ${user.aioUserUUID ? `<code>${user.aioUserUUID}</code>` : "не указан"}`,
    `Регистрация: ${user.createdAt.toLocaleString("ru-RU")}`,
  ];
  if (user.processedBy) {
    const when = user.processedAt ? ` (${user.processedAt.toLocaleString("ru-RU")})` : "";
    lines.push(`Обработал: <code>${user.processedBy}</code>${when}`);
  }
  return { text: lines.join("\n"), keyboard: buildUserCardKeyboard(user) };
}
