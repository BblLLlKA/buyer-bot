import type { Api } from "grammy";
import { logger } from "../config/logger";

const log = logger.child({ module: "utils:progressLog" });

/**
 * Progress is reported by repeatedly editing the single message created for
 * a job when it was enqueued — one line per finished step, plus a transient
 * "⏳/🔍/💳..." line for whatever's currently running.
 */
export function createProgressLog(api: Api, chatId: number, messageId: number, header: string, initialLines: string[] = []) {
  const lines: string[] = [...initialLines];

  const render = async () => {
    const text = [header, "", ...lines].join("\n");
    try {
      await api.editMessageText(chatId, messageId, text);
    } catch (err) {
      log.warn({ err, chatId, messageId }, "Failed to update progress message");
    }
  };

  return {
    /** Appends a new (typically transient) line. */
    async step(line: string) {
      lines.push(line);
      await render();
    },
    /** Replaces the last line (closing out the transient step), optionally starting the next one. */
    async resolve(finalLine: string, nextLine?: string) {
      lines[lines.length - 1] = finalLine;
      if (nextLine) lines.push(nextLine);
      await render();
    },
  };
}
