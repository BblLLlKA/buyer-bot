import pino from "pino";
import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "./env";

/**
 * Carries requestId (per Telegram update) / jobId (per BullMQ job) across
 * whatever async call chain is currently running, without threading them
 * through every function signature. Set via withRequestId/withJobId below;
 * read automatically by every log call through pino's `mixin` hook.
 */
interface LogContext {
  requestId?: string;
  jobId?: string;
}

const logContext = new AsyncLocalStorage<LogContext>();

export const logger = pino({
  level: env.logLevel,
  mixin() {
    return logContext.getStore() ?? {};
  },
  // Defense in depth: none of our own log calls pass secrets directly, but
  // this catches it if a raw external-API request/response object (headers,
  // params) is ever logged wholesale instead of through the usual
  // url/command/status fields.
  redact: {
    paths: [
      "*.token",
      "*.apiKey",
      "*.ApiKey",
      "*.ApiUser",
      "*.password",
      "*.headers.Cookie",
      "*.headers.cookie",
      "*.headers.Authorization",
      "*.headers.authorization",
    ],
    censor: "[REDACTED]",
  },
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true } },
});

/** Runs `fn` with `requestId` attached to every log line emitted inside it (and any awaited calls it makes). */
export function withRequestId<T>(requestId: string | number, fn: () => Promise<T>): Promise<T> {
  return logContext.run({ ...(logContext.getStore() ?? {}), requestId: String(requestId) }, fn);
}

/** Runs `fn` with `jobId` attached to every log line emitted inside it (and any awaited calls it makes). */
export function withJobId<T>(jobId: string | number, fn: () => Promise<T>): Promise<T> {
  return logContext.run({ ...(logContext.getStore() ?? {}), jobId: String(jobId) }, fn);
}
