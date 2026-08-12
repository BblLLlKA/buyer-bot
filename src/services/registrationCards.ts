import type { Api } from "grammy";
import { User, type UserStatus } from "../models/User";
import { renderRegistrationCard, REGISTRATION_STATUS_LABELS } from "../screens/registrationCard";
import { adminLabel } from "../utils/userLabel";
import { logger } from "../config/logger";

const log = logger.child({ module: "service:registration-cards" });

export interface RegistrationCardUser {
  telegramId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  createdAt: Date;
  status: UserStatus;
  processedBy?: number | null;
  notifiedAdmins?: { adminId: number; messageId: number }[];
}

/**
 * Strips Mongoose-ness (Document wrapper, DocumentArray, etc.) down to a
 * plain, structured-clone-safe object. Required before handing a user doc to
 * `conversation.external()` — the conversations plugin clones its return
 * value via `structuredClone`, which throws on Mongoose's array/document
 * subclasses ("[object Array] could not be cloned").
 */
export function toPlainRegistrationCardUser(user: RegistrationCardUser): RegistrationCardUser {
  return {
    telegramId: user.telegramId,
    username: user.username ?? null,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    createdAt: user.createdAt,
    status: user.status,
    processedBy: user.processedBy ?? null,
    notifiedAdmins: [...(user.notifiedAdmins ?? [])].map((e) => ({ adminId: e.adminId, messageId: e.messageId })),
  };
}

/** Builds the "processed by X" label shown once a registration card is resolved. */
export async function processedByLabelFor(user: RegistrationCardUser): Promise<string | undefined> {
  if (!user.processedBy || user.status === "pending") return undefined;
  const processor = await User.findOne({ telegramId: user.processedBy });
  const label = adminLabel(processor ? { id: processor.telegramId, username: processor.username } : null, user.processedBy);
  const statusLabel = REGISTRATION_STATUS_LABELS[user.status as Exclude<UserStatus, "pending">] ?? user.status;
  return `${statusLabel} — ${label}`;
}

/**
 * Returns `user.notifiedAdmins` with the given chat/message folded in if
 * it's missing — used right after an admin acts on a card, in case the
 * notify worker hadn't finished recording that admin's copy yet.
 */
export function foldInActingMessage<T extends RegistrationCardUser>(
  user: T,
  chatId: number | undefined,
  messageId: number | undefined,
): { adminId: number; messageId: number }[] {
  const notifiedAdmins = user.notifiedAdmins ?? [];
  if (!chatId || !messageId) return notifiedAdmins;
  const alreadyTracked = notifiedAdmins.some((e) => e.adminId === chatId && e.messageId === messageId);
  return alreadyTracked ? notifiedAdmins : [...notifiedAdmins, { adminId: chatId, messageId }];
}

/**
 * Re-renders and edits every admin's copy of a registration card
 * (tracked via `notifiedAdmins`) so nobody sees a stale "pending" card once
 * the request has moved on — including the later approve -> AIO UUID saved
 * transition, which happens well after the original decision.
 */
export async function syncRegistrationCards(
  api: Api,
  user: RegistrationCardUser,
  processedByLabel?: string,
): Promise<void> {
  const { text, keyboard } = renderRegistrationCard({
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    createdAt: user.createdAt,
    status: user.status,
    processedByLabel,
  });

  log.debug(
    { telegramId: user.telegramId, status: user.status, cardCount: user.notifiedAdmins?.length ?? 0 },
    "Syncing registration cards across admins",
  );

  for (const entry of user.notifiedAdmins ?? []) {
    try {
      await api.editMessageText(entry.adminId, entry.messageId, text, {
        reply_markup: keyboard,
        parse_mode: "HTML",
      });
    } catch (err) {
      // The admin's message may have been deleted or the bot blocked — safe to ignore.
      log.debug({ err, adminId: entry.adminId, telegramId: user.telegramId }, "Failed to sync one registration card");
    }
  }
}
