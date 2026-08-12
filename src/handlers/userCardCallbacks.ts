import type { MyContext } from "../types";
import { getUserByTelegramId, setBanned, setRole } from "../services/userService";
import { renderUserCard } from "../screens/userCard";
import { renderScreen } from "../utils/safeEdit";
import { parseTargetId } from "../utils/callbackData";
import { logger } from "../config/logger";

const log = logger.child({ module: "handler:user-card" });

export async function adminUserCardHandler(ctx: MyContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const targetId = parseTargetId(ctx.callbackQuery?.data ?? "");
  if (targetId === null) return;

  const user = await getUserByTelegramId(targetId);
  if (!user) {
    log.warn({ adminId: ctx.from?.id, targetId }, "Admin opened user card for a non-existent user");
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
  log.info({ adminId: ctx.from!.id, targetId, found: Boolean(user) }, "Admin banned a user");
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
  log.info({ adminId: ctx.from!.id, targetId, found: Boolean(user) }, "Admin unbanned a user");
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
    log.warn({ adminId: ctx.from?.id, targetId }, "Admin tried to toggle role of a non-existent user");
    await ctx.answerCallbackQuery();
    return;
  }
  const nextRole = current.role === "admin" ? "buyer" : "admin";
  const user = await setRole(targetId, nextRole);
  log.info({ adminId: ctx.from!.id, targetId, previousRole: current.role, nextRole }, "Admin changed a user's role");
  await ctx.answerCallbackQuery({ text: `Роль изменена на ${nextRole}` });
  if (user) await renderScreen(ctx, renderUserCard(user));
}
