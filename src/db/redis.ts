import Redis, { type RedisOptions } from "ioredis";
import { env } from "../config/env";
import { logger } from "../config/logger";

const log = logger.child({ module: "db" });

/**
 * BullMQ requires its own connection with maxRetriesPerRequest: null,
 * so we expose a factory instead of a single shared client.
 */
export function createRedisClient(options: RedisOptions = {}): Redis {
  const client = new Redis(env.redisUrl, options);
  client.on("error", (err) => log.error({ err }, "Redis client error"));
  client.on("connect", () => log.debug("Redis client connected"));
  client.on("ready", () => log.info("Redis client ready"));
  client.on("close", () => log.warn("Redis client connection closed"));
  client.on("reconnecting", (delay: number) => log.debug({ delay }, "Redis client reconnecting"));
  return client;
}

// Shared client used for grammY session storage.
export const sessionRedis = createRedisClient();

// Dedicated client for BullMQ (queue + worker), per BullMQ requirements.
export const bullRedis = createRedisClient({ maxRetriesPerRequest: null });
