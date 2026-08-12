import { env } from "../config/env";
import { User } from "../models/User";
import { logger } from "../config/logger";

const log = logger.child({ module: "service:admin" });

/** Ensures every ID listed in ADMIN_IDS exists as an approved admin. */
export async function ensurePrimaryAdmins(): Promise<void> {
  log.debug({ primaryAdminIds: env.primaryAdminIds }, "Ensuring primary admins exist");
  await Promise.all(
    env.primaryAdminIds.map((telegramId) =>
      User.findOneAndUpdate(
        { telegramId },
        { $setOnInsert: { telegramId }, role: "admin", status: "approved" },
        { upsert: true, setDefaultsOnInsert: true },
      ),
    ),
  );
  log.info({ count: env.primaryAdminIds.length }, "Primary admins ensured");
}

export async function getAdminTelegramIds(): Promise<number[]> {
  const admins = await User.find({ role: "admin", status: "approved" }, { telegramId: 1 });
  return admins.map((a) => a.telegramId);
}
