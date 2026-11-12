// ── Chat store: persistence-agnostic channel/message storage ─────────────────
// Two implementations: D1 (Cloudflare Worker) and Prisma (Express/Postgres).
// The Worker build imports ONLY this file; the Prisma implementation lives in
// store-prisma.ts so the Prisma client never enters the Worker bundle.
import { MemoryChatStore } from "./store-parts/pure";
import type { ChatStore } from "./store-parts/types";
import { D1ChatStore } from "./store-parts/io";

// Pieces split into ./store-parts/ (importable on their own); re-exported for compat.
export type { ChatUser, ChatChannel, ChatAttachment, ChatMessage, ChatReaction, ChatStore } from "./store-parts/types";
export { resolveLinkedSender } from "./store-parts/io";

let cachedMemory: MemoryChatStore | null = null;

export function createChatStore(env: any): ChatStore {
  if (env && env.DB && typeof env.DB.prepare === "function") return new D1ChatStore(env.DB);
  if (env && env.__prismaChatStore) return env.__prismaChatStore as ChatStore;
  if (!cachedMemory) cachedMemory = new MemoryChatStore();
  return cachedMemory;
}

export { MemoryChatStore };
