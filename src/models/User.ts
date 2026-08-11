import { Schema, model, type InferSchemaType } from "mongoose";

export const USER_ROLES = ["buyer", "admin"] as const;
// "awaiting_uuid" sits between pending and approved: the admin has already
// approved the request, but registration only finishes once the applicant
// supplies their AIO UUID (see the aioUuidConversation).
export const USER_STATUSES = ["pending", "awaiting_uuid", "approved", "rejected", "banned"] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];

// Tracks which admins were notified about a pending registration, and where
// (chatId/messageId), so that when one admin resolves it we can go back and
// edit every other admin's copy of the card instead of leaving them stale.
const NotifiedAdminSchema = new Schema(
  {
    adminId: { type: Number, required: true },
    messageId: { type: Number, required: true },
  },
  { _id: false },
);

const UserSchema = new Schema(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: { type: String, default: null },
    firstName: { type: String, default: null },
    lastName: { type: String, default: null },
    role: { type: String, enum: USER_ROLES, default: "buyer", required: true },
    status: { type: String, enum: USER_STATUSES, default: "pending", required: true, index: true },
    processedBy: { type: Number, default: null },
    processedAt: { type: Date, default: null },
    notifiedAdmins: { type: [NotifiedAdminSchema], default: [] },
    aioUserUUID: { type: String, default: null },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof UserSchema>;

export const User = model("User", UserSchema);
