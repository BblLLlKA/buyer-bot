import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import { Worker, type Job } from "bullmq";
import type { Api } from "grammy";
import { bullRedis } from "../db/redis";
import { logger, withJobId } from "../config/logger";
import {
  createMultipartUpload,
  uploadPart,
  completeMultipartUpload,
  buildZipUrl,
  createLander,
  shareLander,
} from "../services/aioApi";
import { deleteTempFile } from "../utils/tmpStorage";
import { createProgressLog } from "../utils/progressLog";
import { LANDER_UPLOAD_QUEUE, type LanderUploadJobData } from "./landerUploadQueue";

const log = logger.child({ module: "worker:lander-upload" });

const ZIP_CONTENT_TYPE = "application/x-zip-compressed";

/**
 * Processes one archive end to end: create a multipart upload slot in AIO ->
 * upload the archive to it (one or more parts, depending on file size vs the
 * part size AIO assigns) -> complete the upload -> create the lander from
 * the resulting file URL -> share the lander with the session's assignee
 * user. Business rejections (AIO validation errors on the Lander\Upload or
 * Universal\ShareUnshare calls) resolve the job normally with a final status
 * line — not retried. Only unexpected errors (AIO network/HTTP failures at
 * any step) are thrown, which is what triggers BullMQ's retry/backoff.
 *
 * Every completed step is persisted to job.data via job.updateData, so a
 * retry after a later technical failure resumes instead of redoing work:
 * the upload slot (key/uploadId/partSize) once created, each part's
 * {partNumber, etag} as it's uploaded, the zipUrl once the upload is
 * completed, and landerUuid once Lander\Upload succeeds — so a technical
 * failure in the *sharing* step doesn't cause a retry to create a second,
 * duplicate lander. The one gap that's inherent to the endpoints available
 * (not something this persistence closes) is the narrow window between AIO
 * actually creating the lander and this job successfully reading/persisting
 * that response — a crash exactly there would still cause a retry to create
 * a duplicate, since AIO doesn't expose a way to look up whether a lander
 * was already created from a given zip_url.
 *
 * The archive itself lives on disk (see src/utils/tmpStorage.ts), not in
 * job.data — deleted once the job is done for good (success, a business
 * rejection, or the last retry attempt failing), never on a retryable
 * technical failure, since the file is still needed to resume.
 */
export function createLanderUploadWorker(api: Api): Worker<LanderUploadJobData> {
  return new Worker<LanderUploadJobData>(
    LANDER_UPLOAD_QUEUE,
    (job: Job<LanderUploadJobData>) => withJobId(job.id ?? "unknown", () => processLanderUploadJob(api, job)),
    { connection: bullRedis },
  );
}

async function processLanderUploadJob(api: Api, job: Job<LanderUploadJobData>): Promise<void> {
  const { filePath, originalName, telegramId, chatId, messageId, assigneeUuid } = job.data;
  const landerName = originalName.replace(/\.zip$/i, "");
  const header = `📦 Файл: ${originalName}`;

  const hasUploadSlot = Boolean(job.data.uploadKey && job.data.uploadId && job.data.partSize);
  const hasZipUrl = Boolean(job.data.zipUrl);
  const hasLanderUuid = Boolean(job.data.landerUuid);
  log.debug(
    {
      originalName,
      telegramId,
      hasUploadSlot,
      uploadedParts: job.data.uploadedParts?.length ?? 0,
      hasZipUrl,
      hasLanderUuid,
    },
    "Processing lander-upload job",
  );

  let stat: Stats;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    // Not retryable — if the file is gone there's nothing a retry can do
    // (it can't re-download from Telegram; the conversation that collected
    // it is long over). Also nothing to clean up.
    log.error({ err, filePath, originalName }, "Temp upload file missing, cannot process lander-upload job");
    await createProgressLog(api, chatId, messageId, header, []).resolve(
      "❌ Внутренняя ошибка: исходный файл архива не найден на диске.",
    );
    return;
  }

  const initialLines: string[] = [];
  let totalParts = 1;
  if (hasUploadSlot) {
    initialLines.push("✅ Файл создан в AIO");
    totalParts = Math.max(1, Math.ceil(stat.size / job.data.partSize!));
    const uploadedCount = job.data.uploadedParts?.length ?? 0;
    if (uploadedCount >= totalParts) {
      initialLines.push(totalParts === 1 ? "✅ Архив загружен" : `✅ Архив загружен (${totalParts} частей)`);
    }
  }
  if (hasZipUrl) {
    initialLines.push("✅ Загрузка завершена");
  }
  if (hasLanderUuid) {
    initialLines.push("✅ Вайт успешно создан в AIO");
  }

  const progress = createProgressLog(api, chatId, messageId, header, initialLines);
  let shouldCleanup = false;

  try {
    let uploadKey = job.data.uploadKey;
    let uploadId = job.data.uploadId;
    let partSize = job.data.partSize;

    if (!hasUploadSlot) {
      await progress.step("⏳ Создание файла в AIO...");
      const created = await createMultipartUpload({ name: originalName, contentType: ZIP_CONTENT_TYPE });
      uploadKey = created.key;
      uploadId = created.uploadId;
      partSize = created.partSize;
      totalParts = Math.max(1, Math.ceil(stat.size / partSize));
      await job.updateData({ ...job.data, uploadKey, uploadId, partSize });
      await progress.resolve("✅ Файл создан в AIO");
    }

    let uploadedParts = job.data.uploadedParts ?? [];
    if (uploadedParts.length < totalParts) {
      const buffer = await fs.readFile(filePath);
      const nextPartNumber = uploadedParts.length + 1;
      await progress.step(
        totalParts === 1 ? "⏳ Загрузка архива..." : `⏳ Загрузка частей (${nextPartNumber}/${totalParts})...`,
      );

      for (let partNumber = nextPartNumber; partNumber <= totalParts; partNumber++) {
        const start = (partNumber - 1) * partSize!;
        const end = Math.min(start + partSize!, buffer.length);
        const uploaded = await uploadPart({
          key: uploadKey!,
          uploadId: uploadId!,
          partNumber,
          contentType: ZIP_CONTENT_TYPE,
          body: Buffer.from(buffer.subarray(start, end)),
        });
        uploadedParts = [...uploadedParts, uploaded];
        await job.updateData({ ...job.data, uploadKey, uploadId, partSize, uploadedParts });

        if (partNumber < totalParts) {
          await progress.resolve(
            `✅ Часть ${partNumber}/${totalParts} загружена`,
            `⏳ Загрузка частей (${partNumber + 1}/${totalParts})...`,
          );
        }
      }

      await progress.resolve(totalParts === 1 ? "✅ Архив загружен" : `✅ Архив загружен (${totalParts} частей)`);
    }

    let zipUrl = job.data.zipUrl;
    if (!zipUrl) {
      await progress.step("⏳ Завершение загрузки...");
      await completeMultipartUpload({
        key: uploadKey!,
        uploadId: uploadId!,
        name: originalName,
        parts: uploadedParts,
      });
      zipUrl = buildZipUrl(uploadKey!);
      await job.updateData({ ...job.data, uploadKey, uploadId, partSize, uploadedParts, zipUrl });
      await progress.resolve("✅ Загрузка завершена");
    }

    let landerUuid = job.data.landerUuid;
    if (!landerUuid) {
      await progress.step("⏳ Создание вайта в AIO...");
      const created = await createLander({ name: landerName, zipUrl });
      if (!created.success) {
        log.warn({ originalName, telegramId, error: created.error }, "AIO rejected lander creation");
        await progress.resolve(`❌ ${created.error}`);
        shouldCleanup = true;
        return;
      }

      landerUuid = created.landerUuid;
      log.info({ originalName, telegramId, landerName, landerUuid }, "Lander created in AIO");
      await job.updateData({ ...job.data, uploadKey, uploadId, partSize, uploadedParts, zipUrl, landerUuid });
      await progress.resolve("✅ Вайт успешно создан в AIO", "⏳ Шаринг вайта...");
    } else {
      await progress.step("⏳ Шаринг вайта...");
    }

    const shared = await shareLander({ landerUuid, assigneeUuid });
    if (!shared.success) {
      log.warn({ originalName, telegramId, landerUuid, assigneeUuid, error: shared.error }, "AIO rejected lander sharing");
      await progress.resolve(`❌ ${shared.error}. Вайт создан, но не расшарен — требуется ручная проверка.`);
      shouldCleanup = true;
      return;
    }

    log.info({ originalName, telegramId, landerUuid, assigneeUuid }, "Lander shared with assignee in AIO");
    await progress.resolve("✅ Вайт расшарен на пользователя");
    shouldCleanup = true;
  } catch (err) {
    const attemptsAllowed = job.opts.attempts ?? 1;
    const isLastAttempt = job.attemptsMade + 1 >= attemptsAllowed;
    if (isLastAttempt) {
      await progress.resolve("❌ Техническая ошибка при обращении к AIO API");
      shouldCleanup = true;
    }
    log.error({ err, originalName }, "AIO API call failed while processing lander upload");
    throw err;
  } finally {
    if (shouldCleanup) {
      await deleteTempFile(filePath);
    }
  }
}
