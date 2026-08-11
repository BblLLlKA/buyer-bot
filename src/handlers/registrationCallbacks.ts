import type { MyContext } from "../types";
import { resolveRegistration } from "../services/userService";
import { syncRegistrationCards, processedByLabelFor, foldInActingMessage } from "../services/registrationCards";
import { REGISTRATION_STATUS_LABELS } from "../screens/registrationCard";
import { User, type UserStatus } from "../models/User";
import { logger } from "../config/logger";
import { AIO_UUID_FOR_USER_CONVERSATION_NAME } from "../conversations/aioUuidForUserConversation";

type FinalDecision = "reject" | "ban";

const DECISION_STATUS: Record<FinalDecision, Exclude<UserStatus, "pending">> = {
  reject: "rejected",
  ban: "banned",
};

const USER_MESSAGES: Record<FinalDecision, string> = {
  reject: "❌ Ваша заявка была отклонена.",
  ban: "🚫 Вы были заблокированы администратором.",
};

function adminLabelOf(admin: { id: number; username?: string }): string {
  return admin.username ? `@${admin.username}` : `ID ${admin.id}`;
}

function parseTargetId(data: string): number | null {
  const id = Number(data.split(":")[2]);
  return Number.isInteger(id) ? id : null;
}

/** Handles the "❌ Отклонить" / "🚫 Забанить" buttons — final, one-shot decisions. */
export function registrationDecisionHandler(decision: FinalDecision) {
  return async (ctx: MyContext) => {
    const targetId = parseTargetId(ctx.callbackQuery?.data ?? "");
    if (targetId === null) {
      await ctx.answerCallbackQuery();
      return;
    }

    const admin = ctx.from!;
    const nextStatus = DECISION_STATUS[decision];

    // Atomic transition: the filter requires status === 'pending', so if two
    // admins tap different buttons on their own copy of the card at nearly
    // the same time, only the first write wins and the second gets `null`.
    const updated = await resolveRegistration(targetId, nextStatus, admin.id);

    if (!updated) {
      await ctx.answerCallbackQuery({ text: "Заявка уже обработана.", show_alert: true });
      const current = await User.findOne({ telegramId: targetId });
      if (current) {
        const label = await processedByLabelFor(current);
        await syncRegistrationCards(ctx.api, current, label);
      }
      return;
    }

    await ctx.answerCallbackQuery({ text: "Готово" });

    const processedByLabel = `${REGISTRATION_STATUS_LABELS[nextStatus]} — ${adminLabelOf(admin)}`;

    // Sync every admin's copy of the card (including this one) so nobody
    // else can try to process an already-resolved request.
    const notifiedAdmins = foldInActingMessage(updated, ctx.chat?.id, ctx.callbackQuery?.message?.message_id);
    await syncRegistrationCards(
      ctx.api,
      {
        telegramId: updated.telegramId,
        username: updated.username,
        firstName: updated.firstName,
        lastName: updated.lastName,
        createdAt: updated.createdAt,
        status: updated.status,
        processedBy: updated.processedBy,
        notifiedAdmins,
      },
      processedByLabel,
    );

    try {
      await ctx.api.sendMessage(updated.telegramId, USER_MESSAGES[decision]);
    } catch (err) {
      logger.warn({ err, telegramId: updated.telegramId }, "Failed to notify user about registration decision");
    }
  };
}

/**
 * Handles "✅ Подтвердить". Unlike reject/ban this isn't a one-shot decision:
 * it locks the request (pending -> awaiting_uuid, same atomic guard as
 * above) and then starts a conversation *in the admin's own chat* asking
 * them for the applicant's AIO UUID — nothing is sent to the applicant and
 * registration isn't complete until that conversation finishes
 * successfully. See aioUuidForUserConversation for the rest of the flow,
 * including /cancel handling that unlocks the request again.
 */
export async function registrationApproveHandler(ctx: MyContext): Promise<void> {
  const targetId = parseTargetId(ctx.callbackQuery?.data ?? "");
  if (targetId === null) {
    await ctx.answerCallbackQuery();
    return;
  }

  const admin = ctx.from!;
  const updated = await resolveRegistration(targetId, "awaiting_uuid", admin.id);

  if (!updated) {
    await ctx.answerCallbackQuery({ text: "Заявка уже обработана.", show_alert: true });
    const current = await User.findOne({ telegramId: targetId });
    if (current) {
      const label = await processedByLabelFor(current);
      await syncRegistrationCards(ctx.api, current, label);
    }
    return;
  }

  await ctx.answerCallbackQuery();

  const processedByLabel = `${REGISTRATION_STATUS_LABELS.awaiting_uuid} — ${adminLabelOf(admin)}`;
  const notifiedAdmins = foldInActingMessage(updated, ctx.chat?.id, ctx.callbackQuery?.message?.message_id);
  await syncRegistrationCards(
    ctx.api,
    {
      telegramId: updated.telegramId,
      username: updated.username,
      firstName: updated.firstName,
      lastName: updated.lastName,
      createdAt: updated.createdAt,
      status: updated.status,
      processedBy: updated.processedBy,
      notifiedAdmins,
    },
    processedByLabel,
  );

  await ctx.conversation.enter(AIO_UUID_FOR_USER_CONVERSATION_NAME, targetId);
}
