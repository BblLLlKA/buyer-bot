import { session } from "grammy";
import { RedisAdapter } from "@grammyjs/storage-redis";
import { sessionRedis } from "../db/redis";
import { initialSession, type MyContext, type SessionData } from "../types";

export const sessionMiddleware = session<SessionData, MyContext>({
  initial: initialSession,
  storage: new RedisAdapter({ instance: sessionRedis }),
});
