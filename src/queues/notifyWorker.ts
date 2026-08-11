import { Worker, type Job } from "bullmq";
import type { Api } from "grammy";
import { bullRedis } from "../db/redis";
import { logger } from "../config/logger";
import { getAdminTelegramIds } from "../services/adminService";
import { addNotifiedAdmin } from "../services/userService";
import { renderRegistrationCard } from "../screens/registrationCard";
import { ADMIN_NOTIFY_QUEUE, type AdminNotifyJobData } from "./notifyQueue";

/**
 * Broadcasts a "new registration" card to every approved admin. Runs off the
 * main update-handling flow (BullMQ job, with retry/backoff on Telegram API
 * failures) so a slow or failing admin fan-out never blocks /start.
 */
export function createNotifyWorker(api: Api): Worker<AdminNotifyJobData> {
  return new Worker<AdminNotifyJobData>(
    ADMIN_NOTIFY_QUEUE,
    async (job: Job<AdminNotifyJobData>) => {
      const { telegramId, username, firstName, lastName, createdAtIso } = job.data;
      const adminIds = await getAdminTelegramIds();

      const { text, keyboard } = renderRegistrationCard({
        telegramId,
        username,
        firstName,
        lastName,
        createdAt: new Date(createdAtIso),
        status: "pending",
      });

      for (const adminId of adminIds) {
        try {
          const message = await api.sendMessage(adminId, text, {
            reply_markup: keyboard,
            parse_mode: "HTML",
          });
          await addNotifiedAdmin(telegramId, adminId, message.message_id);
        } catch (err) {
          logger.warn({ err, adminId }, "Failed to notify admin about new registration");
        }
      }
    },
    { connection: bullRedis },
  );
}
