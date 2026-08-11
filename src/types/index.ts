import type { Context, SessionFlavor } from "grammy";
import type { Conversation, ConversationFlavor } from "@grammyjs/conversations";
import type { UserRole, UserStatus } from "../models/User";

export type AdminUserFilter = "all" | "pending" | "awaiting_uuid" | "approved" | "banned";

export interface SessionData {
  /** Current admin user-list filter + page, remembered across navigation. */
  adminPanel: {
    filter: AdminUserFilter;
    page: number;
  };
  /** Set while we're waiting for a free-text search query from an admin. */
  awaitingSearch: boolean;
}

export function initialSession(): SessionData {
  return {
    adminPanel: { filter: "all", page: 0 },
    awaitingSearch: false,
  };
}

/** Info about the caller resolved by the userStatus middleware. */
export interface AuthState {
  telegramId: number;
  role: UserRole;
  status: UserStatus;
  aioUserUUID: string | null;
}

type BaseContext = Context &
  SessionFlavor<SessionData> & {
    auth?: AuthState;
  };

export type MyContext = ConversationFlavor<BaseContext>;

export type MyConversation = Conversation<MyContext, MyContext>;
