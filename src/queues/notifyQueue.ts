import { Queue } from "bullmq";
import { bullRedis } from "../db/redis";

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
  return notifyQueue.add("notify-new-registration", data);
}
