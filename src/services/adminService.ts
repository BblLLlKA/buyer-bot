import { env } from "../config/env";
import { User } from "../models/User";

/** Ensures every ID listed in ADMIN_IDS exists as an approved admin. */
export async function ensurePrimaryAdmins(): Promise<void> {
  await Promise.all(
    env.primaryAdminIds.map((telegramId) =>
      User.findOneAndUpdate(
        { telegramId },
        { $setOnInsert: { telegramId }, role: "admin", status: "approved" },
        { upsert: true, setDefaultsOnInsert: true },
      ),
    ),
  );
}

export async function getAdminTelegramIds(): Promise<number[]> {
  const admins = await User.find({ role: "admin", status: "approved" }, { telegramId: 1 });
  return admins.map((a) => a.telegramId);
}
