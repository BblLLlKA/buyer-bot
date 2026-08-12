import mongoose from "mongoose";
import { env } from "../config/env";
import { logger } from "../config/logger";

const log = logger.child({ module: "db" });

export async function connectMongo(): Promise<void> {
  mongoose.set("strictQuery", true);

  mongoose.connection.on("error", (err) => log.error({ err }, "MongoDB connection error"));
  mongoose.connection.on("disconnected", () => log.warn("MongoDB disconnected"));
  mongoose.connection.on("reconnected", () => log.info("MongoDB reconnected"));

  log.debug("Connecting to MongoDB...");
  await mongoose.connect(env.mongoUri);
  log.info("MongoDB connected");
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
  log.info("MongoDB disconnected (explicit)");
}
