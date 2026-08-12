import { Queue } from "bullmq";
import { bullRedis } from "../db/redis";
import { logger } from "../config/logger";

const log = logger.child({ module: "queue" });

export const ADMIN_NOTIFY_QUEUE = "admin-notify";

export interface AdminNotifyJobData {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  createdAtIso: string;
}

export const notifyQueue = new Queue<AdminNotifyJobData>(ADMIN_NOTIFY_QUEUE, {
  connection: bullRedis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 50,
  },
});

export function enqueueAdminNotification(data: AdminNotifyJobData) {
  log.debug({ telegramId: data.telegramId }, "Enqueuing admin-notify job");
  return notifyQueue.add("notify-new-registration", data);
}
