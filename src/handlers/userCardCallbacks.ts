import type { MyContext } from "../types";
import { getUserByTelegramId, setBanned, setRole } from "../services/userService";
import { renderUserCard } from "../screens/userCard";
import { renderScreen } from "../utils/safeEdit";

function parseTargetId(data: string): number | null {
  const id = Number(data.split(":")[2]);
  return Number.isInteger(id) ? id : null;
}

export async function adminUserCardHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const targetId = parseTargetId(ctx.callbackQuery?.data ?? "");
  if (targetId === null) return;

  const user = await getUserByTelegramId(targetId);
  if (!user) {
    await ctx.reply("Пользователь не найден.");
    return;
  }
  await renderScreen(ctx, renderUserCard(user));
}

export async function adminBanHandler(ctx: MyContext): Promise<void> {
  const targetId = parseTargetId(ctx.callbackQuery?.data ?? "");
  if (targetId === null) {
    await ctx.answerCallbackQuery();
    return;
  }
  const user = await setBanned(targetId, true, ctx.from!.id);
  await ctx.answerCallbackQuery({ text: "Пользователь забанен" });
  if (user) await renderScreen(ctx, renderUserCard(user));
}

export async function adminUnbanHandler(ctx: MyContext): Promise<void> {
  const targetId = parseTargetId(ctx.callbackQuery?.data ?? "");
  if (targetId === null) {
    await ctx.answerCallbackQuery();
    return;
  }
  const user = await setBanned(targetId, false, ctx.from!.id);
  await ctx.answerCallbackQuery({ text: "Пользователь разбанен" });
  if (user) await renderScreen(ctx, renderUserCard(user));
}

export async function adminToggleRoleHandler(ctx: MyContext): Promise<void> {
  const targetId = parseTargetId(ctx.callbackQuery?.data ?? "");
  if (targetId === null) {
    await ctx.answerCallbackQuery();
    return;
  }
  const current = await getUserByTelegramId(targetId);
  if (!current) {
    await ctx.answerCallbackQuery();
    return;
  }
  const nextRole = current.role === "admin" ? "buyer" : "admin";
  const user = await setRole(targetId, nextRole);
  await ctx.answerCallbackQuery({ text: `Роль изменена на ${nextRole}` });
  if (user) await renderScreen(ctx, renderUserCard(user));
}
