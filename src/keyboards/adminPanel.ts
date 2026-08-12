import { InlineKeyboard } from "grammy";
import type { AdminUserFilter } from "../types";
import type { UserHydrated } from "../services/userService";

/** Shared with screens/adminUserList.ts — one source of truth for filter labels. */
export const FILTER_LABELS: Record<AdminUserFilter, string> = {
  all: "Все",
  pending: "Ожидают",
  awaiting_uuid: "Ждут UUID",
  approved: "Подтверждены",
  banned: "Забанены",
};

const STATUS_ICONS: Record<string, string> = {
  pending: "⏳",
  awaiting_uuid: "🔑",
  approved: "✅",
  rejected: "❌",
  banned: "🚫",
};

export function buildAdminListKeyboard(
  users: UserHydrated[],
  filter: AdminUserFilter,
  page: number,
  totalPages: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  (Object.keys(FILTER_LABELS) as AdminUserFilter[]).forEach((key, i) => {
    const label = key === filter ? `• ${FILTER_LABELS[key]} •` : FILTER_LABELS[key];
    keyboard.text(label, `admin:list:${key}:0`);
    if (i % 2 === 1) keyboard.row();
  });
  keyboard.row();

  for (const u of users) {
    const icon = STATUS_ICONS[u.status] ?? "";
    const label = `${icon} ${u.username ? "@" + u.username : u.telegramId} (${u.firstName ?? "—"})`;
    keyboard.text(label.slice(0, 64), `admin:user:${u.telegramId}`).row();
  }

  if (users.length === 0) {
    keyboard.text("Пусто", "noop").row();
  }

  const navRow: [string, string][] = [];
  if (page > 0) navRow.push(["⬅️", `admin:list:${filter}:${page - 1}`]);
  navRow.push([`${page + 1}/${totalPages}`, "noop"]);
  if (page + 1 < totalPages) navRow.push(["➡️", `admin:list:${filter}:${page + 1}`]);
  for (const [label, data] of navRow) keyboard.text(label, data);
  keyboard.row();

  keyboard.text("🔎 Поиск", "admin:search").row();
  keyboard.text("⬅️ Назад", "menu:main");

  return keyboard;
}
