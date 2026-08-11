import type { RenderedScreen } from "../utils/safeEdit";
import { buildAdminListKeyboard } from "../keyboards/adminPanel";
import { listUsers } from "../services/userService";
import type { AdminUserFilter } from "../types";

export const ADMIN_LIST_PAGE_SIZE = 5;

const FILTER_LABELS: Record<AdminUserFilter, string> = {
  all: "Все",
  pending: "Ожидают",
  awaiting_uuid: "Ждут UUID",
  approved: "Подтверждены",
  banned: "Забанены",
};

export async function renderAdminUserList(filter: AdminUserFilter, page: number): Promise<RenderedScreen> {
  const { items, total, pages } = await listUsers({
    filter,
    page,
    pageSize: ADMIN_LIST_PAGE_SIZE,
  });

  const text = [
    "🛠 <b>Админ-панель</b>",
    "",
    `Фильтр: <b>${FILTER_LABELS[filter]}</b>`,
    `Всего пользователей: ${total}`,
  ].join("\n");

  return { text, keyboard: buildAdminListKeyboard(items, filter, page, pages) };
}
