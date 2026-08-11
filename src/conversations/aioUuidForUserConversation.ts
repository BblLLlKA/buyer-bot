import type { MyContext, MyConversation } from "../types";
import {
  approveWithAioUuid,
  revertToPending,
  findUserByAioUuid,
  getUserByTelegramId,
} from "../services/userService";
import {
  processedByLabelFor,
  syncRegistrationCards,
  toPlainRegistrationCardUser,
  type RegistrationCardUser,
} from "../services/registrationCards";
import { renderMainMenu } from "../screens/mainMenu";
import { logger } from "../config/logger";

export const AIO_UUID_FOR_USER_CONVERSATION_NAME = "aioUuidForUserConversation";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PlainProfile {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
}

function describeUser(user: PlainProfile | null, telegramId: number): string {
  if (user?.username) return `@${user.username}`;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  return name || `ID ${telegramId}`;
}

/**
 * Runs in the *approving admin's* own chat (started from
 * registrationApproveHandler right after the request is locked into
 * `awaiting_uuid`). Collects the AIO UUID on the applicant's behalf, checks
 * for AIO UUID reuse, and only then finalizes the registration.
 *
 * Every `conversation.external()` call below returns a plain, hand-picked
 * object rather than a raw Mongoose document/query result — the plugin
 * clones whatever external() returns via `structuredClone`, which throws on
 * Mongoose's Document/DocumentArray wrapper types.
 */
export async function aioUuidForUserConversation(
  conversation: MyConversation,
  ctx: MyContext,
  targetTelegramId: number,
): Promise<void> {
  const adminTelegramId = ctx.from!.id;

  const target = await conversation.external<PlainProfile | null>(async () => {
    const doc = await getUserByTelegramId(targetTelegramId);
    if (!doc) return null;
    return {
      telegramId: doc.telegramId,
      username: doc.username ?? null,
      firstName: doc.firstName ?? null,
      lastName: doc.lastName ?? null,
    };
  });
  const label = describeUser(target, targetTelegramId);

  await ctx.reply(
    `🔑 Введите AIO UUID для пользователя ${label} (ID <code>${targetTelegramId}</code>).\n\n` +
      `Отправьте /cancel, чтобы отменить — заявка вернётся в очередь ожидания.`,
    { parse_mode: "HTML" },
  );

  let pendingConfirmUuid: string | null = null;

  while (true) {
    // `otherwise` + `next: true` lets any other button the admin taps while
    // we're waiting (e.g. navigating back to the main menu) still work
    // normally through the rest of the middleware chain, instead of being
    // silently swallowed by this conversation.
    const current = await conversation.waitFor("message:text", {
      otherwise: async (skipped) => {
        if (skipped.callbackQuery) await skipped.answerCallbackQuery().catch(() => {});
      },
      next: true,
    });

    const text = current.message.text.trim();

    if (text === "/cancel") {
      const reverted = await conversation.external<RegistrationCardUser | null>(async () => {
        const doc = await revertToPending(targetTelegramId, adminTelegramId);
        return doc ? toPlainRegistrationCardUser(doc) : null;
      });
      if (reverted) await syncRegistrationCards(ctx.api, reverted);
      await current.reply("Отменено. Заявка возвращена в очередь ожидания подтверждения.");
      return;
    }

    if (!UUID_REGEX.test(text)) {
      pendingConfirmUuid = null;
      await current.reply("❌ Неверный формат UUID. Попробуйте снова или отправьте /cancel:");
      continue;
    }

    const isConfirmingSameUuid = pendingConfirmUuid !== null && text.toLowerCase() === pendingConfirmUuid.toLowerCase();

    if (!isConfirmingSameUuid) {
      const conflict = await conversation.external<PlainProfile | null>(async () => {
        const doc = await findUserByAioUuid(text, targetTelegramId);
        if (!doc) return null;
        return {
          telegramId: doc.telegramId,
          username: doc.username ?? null,
          firstName: doc.firstName ?? null,
          lastName: doc.lastName ?? null,
        };
      });
      if (conflict) {
        pendingConfirmUuid = text;
        const conflictLabel = describeUser(conflict, conflict.telegramId);
        await current.reply(
          `⚠️ Этот AIO UUID уже привязан к пользователю ${conflictLabel}. Если это ожидаемо (один AIO-аккаунт на несколько Telegram-аккаунтов), ` +
            `отправьте тот же UUID ещё раз для подтверждения. Либо отправьте другой UUID, либо /cancel:`,
        );
        continue;
      }
    }

    const approved = await conversation.external<RegistrationCardUser | null>(async () => {
      const doc = await approveWithAioUuid(targetTelegramId, text);
      return doc ? toPlainRegistrationCardUser(doc) : null;
    });
    if (!approved) {
      await current.reply("Не удалось сохранить UUID — заявка уже была обработана или отменена кем-то ещё.");
      return;
    }

    const processedByLabel = await conversation.external(() => processedByLabelFor(approved));
    await syncRegistrationCards(ctx.api, approved, processedByLabel);
    await current.reply(`✅ AIO UUID сохранён, заявка пользователя ${label} подтверждена.`);

    const menu = renderMainMenu("buyer", true);
    try {
      await ctx.api.sendMessage(
        targetTelegramId,
        `✅ Ваша заявка подтверждена! Добро пожаловать.\n\n${menu.text}`,
        { reply_markup: menu.keyboard, parse_mode: "HTML" },
      );
    } catch (err) {
      logger.warn({ err, telegramId: targetTelegramId }, "Failed to notify user about registration approval");
    }
    return;
  }
}
