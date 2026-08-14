import { Queue } from "bullmq";
import { bullRedis } from "../db/redis";
import { logger } from "../config/logger";
import type { UploadedPart } from "../services/aioApi";

const log = logger.child({ module: "queue" });

export const LANDER_UPLOAD_QUEUE = "lander-bulk-upload";

export interface LanderUploadJobData {
  // Path to the already-downloaded archive on disk (storage/tmp-uploads/...)
  // — see src/utils/tmpStorage.ts. Deleted by the worker once the job is
  // done for good (success, business rejection, or final failed attempt).
  filePath: string;
  originalName: string;
  telegramId: number;
  chatId: number;
  messageId: number;
  // AIO user uuid the created lander is shared with (Universal\ShareUnshare,
  // assignee_type App\Models\User, type Owner) — entered once by the admin
  // at the start of the upload session and applied to every archive in it.
  assigneeUuid: string;

  // Progress persisted via job.updateData so a BullMQ retry (triggered only
  // by a technical/network failure) resumes instead of redoing completed
  // steps — see landerUploadWorker.ts.
  uploadKey?: string;
  uploadId?: string;
  partSize?: number;
  uploadedParts?: UploadedPart[];
  zipUrl?: string;
  landerUuid?: string;
}

export const landerUploadQueue = new Queue<LanderUploadJobData>(LANDER_UPLOAD_QUEUE, {
  connection: bullRedis,
  defaultJobOptions: {
    // Only network/API failures reach here as thrown errors (see the
    // worker) — business rejections (validation errors, etc.) resolve the
    // job successfully instead, so they're never retried.
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 50,
  },
});

export function enqueueLanderUpload(data: LanderUploadJobData) {
  log.debug({ originalName: data.originalName, telegramId: data.telegramId }, "Enqueuing lander-upload job");
  return landerUploadQueue.add("upload-lander", data);
}
