import { User, type UserDoc, type UserStatus } from "../models/User";
import type { HydratedDocument } from "mongoose";

export type UserHydrated = HydratedDocument<UserDoc>;

export interface TelegramProfile {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export type FindOrCreateResult =
  | { created: true; user: UserHydrated }
  | { created: false; user: UserHydrated };

/**
 * Looks up a user by telegramId, creating a fresh `pending` record on first
 * contact. Uses upsert with $setOnInsert so concurrent /start presses from
 * the same user can't create duplicate rows.
 */
export async function findOrCreateUser(profile: TelegramProfile): Promise<FindOrCreateResult> {
  const existing = await User.findOne({ telegramId: profile.telegramId });
  if (existing) {
    // Keep profile fields fresh (username/name can change).
    existing.username = profile.username ?? null;
    existing.firstName = profile.firstName ?? null;
    existing.lastName = profile.lastName ?? null;
    if (existing.isModified()) await existing.save();
    return { created: false, user: existing };
  }

  const user = await User.findOneAndUpdate(
    { telegramId: profile.telegramId },
    {
      $setOnInsert: {
        telegramId: profile.telegramId,
        username: profile.username ?? null,
        firstName: profile.firstName ?? null,
        lastName: profile.lastName ?? null,
        role: "buyer",
        status: "pending",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // upsert always returns a doc; created === it was just inserted (createdAt === updatedAt)
  const created = user.createdAt.getTime() === user.updatedAt.getTime();
  return { created, user };
}

export function getUserByTelegramId(telegramId: number) {
  return User.findOne({ telegramId });
}

/**
 * Atomically moves a pending registration to its next status (awaiting_uuid
 * on approve, rejected, or banned). The filter requires status === 'pending',
 * so if two admins tap different buttons on their own copy of the card at
 * the same time, only the first write wins and the second gets back `null`
 * — that's the race-condition guard the spec asks for.
 */
export async function resolveRegistration(
  telegramId: number,
  nextStatus: Exclude<UserStatus, "pending">,
  processedBy: number,
): Promise<UserHydrated | null> {
  return User.findOneAndUpdate(
    { telegramId, status: "pending" },
    {
      status: nextStatus,
      processedBy,
      processedAt: new Date(),
    },
    { new: true },
  );
}

/** Saves the AIO UUID without touching status (used for the admin flow). */
export async function setAioUuid(telegramId: number, aioUserUUID: string) {
  return User.findOneAndUpdate({ telegramId }, { aioUserUUID }, { new: true });
}

/**
 * Saves the AIO UUID and completes registration by moving the buyer from
 * `awaiting_uuid` to `approved` in one atomic write.
 */
export async function approveWithAioUuid(telegramId: number, aioUserUUID: string) {
  return User.findOneAndUpdate(
    { telegramId, status: "awaiting_uuid" },
    { aioUserUUID, status: "approved" },
    { new: true },
  );
}

/**
 * Undoes the pending -> awaiting_uuid lock (e.g. the admin handling this
 * request cancelled or never finished entering the AIO UUID), so the request
 * shows up as pending again and can be approved (and locked) by any admin.
 * Scoped to the admin who holds the lock so a stray revert from elsewhere
 * can't clobber someone else's in-progress request.
 */
export async function revertToPending(telegramId: number, processedBy: number) {
  return User.findOneAndUpdate(
    { telegramId, status: "awaiting_uuid", processedBy },
    { status: "pending", processedBy: null, processedAt: null },
    { new: true },
  );
}

/**
 * Looks up another user already using this AIO UUID. `aioUserUUID` is not a
 * unique field on purpose — the same AIO account can legitimately be shared
 * across multiple Telegram accounts (e.g. a team), so duplicates are allowed
 * rather than rejected outright; the admin entering it just gets a heads-up
 * and has to confirm before it's saved (see aioUuidForUserConversation).
 */
export function findUserByAioUuid(aioUserUUID: string, excludeTelegramId: number) {
  return User.findOne({ aioUserUUID, telegramId: { $ne: excludeTelegramId } });
}

export async function setBanned(telegramId: number, banned: boolean, processedBy: number) {
  return User.findOneAndUpdate(
    { telegramId },
    {
      status: banned ? "banned" : "approved",
      processedBy,
      processedAt: new Date(),
    },
    { new: true },
  );
}

export async function setRole(telegramId: number, role: "buyer" | "admin") {
  return User.findOneAndUpdate({ telegramId }, { role }, { new: true });
}

/**
 * Records one more admin's copy of the registration card as it's sent.
 * Pushed incrementally (rather than saved once at the end of the fan-out)
 * so a decision made mid-broadcast still syncs every card sent so far.
 */
export async function addNotifiedAdmin(telegramId: number, adminId: number, messageId: number) {
  await User.updateOne({ telegramId }, { $push: { notifiedAdmins: { adminId, messageId } } });
}

export interface ListUsersOptions {
  filter: UserStatus | "all";
  page: number;
  pageSize: number;
}

export async function listUsers({ filter, page, pageSize }: ListUsersOptions) {
  const query = filter === "all" ? {} : { status: filter };
  const [items, total] = await Promise.all([
    User.find(query)
      .sort({ createdAt: -1 })
      .skip(page * pageSize)
      .limit(pageSize),
    User.countDocuments(query),
  ]);
  return { items, total, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function searchUsers(query: string) {
  const numeric = Number(query);
  const orConditions: Record<string, unknown>[] = [
    { username: { $regex: query.replace(/^@/, ""), $options: "i" } },
  ];
  if (Number.isInteger(numeric)) {
    orConditions.push({ telegramId: numeric });
  }
  return User.find({ $or: orConditions }).limit(10);
}

export interface UserProfileLean {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  aioUserUUID: string | null;
}

/**
 * Same lookup as `searchUsers`, but returns plain objects instead of
 * Mongoose documents — safe to hand to `conversation.external()`, which
 * clones its return value via `structuredClone` (Mongoose documents/arrays
 * aren't cloneable, see aioUuidForUserConversation for the same fix).
 */
export async function searchUserProfiles(query: string): Promise<UserProfileLean[]> {
  const docs = await searchUsers(query);
  return docs.map((d) => ({
    telegramId: d.telegramId,
    username: d.username ?? null,
    firstName: d.firstName ?? null,
    lastName: d.lastName ?? null,
    aioUserUUID: d.aioUserUUID ?? null,
  }));
}
