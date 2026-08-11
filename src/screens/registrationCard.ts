import { InlineKeyboard } from "grammy";
import type { RenderedScreen } from "../utils/safeEdit";
import { buildRegistrationKeyboard } from "../keyboards/registration";
import type { UserStatus } from "../models/User";

export interface RegistrationCardData {
  telegramId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  createdAt: Date;
  status: UserStatus;
  processedByLabel?: string | null;
}

/** Labels for every non-pending status a registration card can end up in. */
export const REGISTRATION_STATUS_LABELS: Record<Exclude<UserStatus, "pending">, string> = {
  awaiting_uuid: "✅ Подтверждено, ожидает AIO UUID",
  approved: "✅ Подтверждено, AIO UUID сохранён",
  rejected: "❌ Отклонено",
  banned: "🚫 Забанен",
};

/** Renders the admin-facing "new registration" card, shared by the queue
 * worker (initial broadcast) and the callback handlers (post-decision edits
 * of every other admin's copy of the same card). */
export function renderRegistrationCard(data: RegistrationCardData): RenderedScreen {
  const name = [data.firstName, data.lastName].filter(Boolean).join(" ") || "—";
  const usernameLine = data.username ? `@${data.username}` : "—";

  const lines = [
    "🆕 <b>Новая заявка на регистрацию</b>",
    "",
    `ID: <code>${data.telegramId}</code>`,
    `Username: ${usernameLine}`,
    `Имя: ${name}`,
    `Дата заявки: ${data.createdAt.toLocaleString("ru-RU")}`,
  ];

  let keyboard = new InlineKeyboard();
  if (data.status === "pending") {
    keyboard = buildRegistrationKeyboard(data.telegramId);
  } else {
    const label = REGISTRATION_STATUS_LABELS[data.status] ?? data.status;
    lines.push("", `<b>${label}</b>` + (data.processedByLabel ? ` — ${data.processedByLabel}` : ""));
  }

  return { text: lines.join("\n"), keyboard };
}
