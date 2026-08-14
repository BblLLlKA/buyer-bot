import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { logger } from "../config/logger";

const log = logger.child({ module: "utils:tmpStorage" });

export const TMP_UPLOAD_DIR = path.join(process.cwd(), "storage", "tmp-uploads");

async function ensureTmpDir(): Promise<void> {
  await fs.mkdir(TMP_UPLOAD_DIR, { recursive: true });
}

/**
 * Downloads a file Telegram is hosting (its `file_path` from getFile) to a
 * fresh, uniquely-named path under storage/tmp-uploads, and returns that
 * path. Used instead of passing the file through BullMQ/Redis directly —
 * archives can be up to a few tens of MB, too large to put in job data.
 */
export async function downloadTelegramFileToTemp(telegramFilePath: string, extension: string): Promise<string> {
  const url = `https://api.telegram.org/file/bot${env.botToken}/${telegramFilePath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download Telegram file: HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  await ensureTmpDir();
  const filePath = path.join(TMP_UPLOAD_DIR, `${randomUUID()}${extension}`);
  await fs.writeFile(filePath, buffer);
  log.debug({ filePath, sizeBytes: buffer.byteLength }, "Downloaded Telegram file to temp storage");
  return filePath;
}

/** Deletes a temp upload file, silently ignoring "already gone". */
export async function deleteTempFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
    log.debug({ filePath }, "Deleted temp upload file");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn({ err, filePath }, "Failed to delete temp upload file");
    }
  }
}

/**
 * Deletes temp upload files older than maxAgeMs. A fallback safety net for
 * files whose owning job never reached its cleanup step (e.g. the process
 * crashed, or the job was lost from Redis) — normal cleanup happens
 * per-job in landerUploadWorker.ts and doesn't rely on this. Intended to be
 * called on an interval (see index.ts), not per-request.
 */
export async function cleanupStaleTempFiles(maxAgeMs: number): Promise<number> {
  await ensureTmpDir();
  const entries = await fs.readdir(TMP_UPLOAD_DIR);
  const now = Date.now();
  let removed = 0;

  for (const entry of entries) {
    const filePath = path.join(TMP_UPLOAD_DIR, entry);
    try {
      const stat = await fs.stat(filePath);
      if (now - stat.mtimeMs > maxAgeMs) {
        await fs.unlink(filePath);
        removed += 1;
      }
    } catch (err) {
      log.warn({ err, filePath }, "Failed to check/remove a stale temp upload file");
    }
  }

  if (removed > 0) {
    log.info({ removed }, "Cleaned up stale temp upload files");
  }
  return removed;
}
