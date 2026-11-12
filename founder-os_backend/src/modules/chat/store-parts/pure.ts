// Extracted verbatim from store.ts by scripts/refactor/split-module.mjs.
// store.ts re-exports everything public here, so existing imports keep working.
import type { ChatAttachment, ChatMessage } from "./types";

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

// Linked accounts: these two logins belong to the same person (Samarth Gupta)
// and share one chat identity — union inbox, shared read state, and every
// message sent from either is attributed to the primary display account.
export const LINKED_ACCOUNT_EMAILS = ["connect.bui2@gmail.com", "crypticlooks@gmail.com"];

export const LINKED_PRIMARY_EMAIL = "crypticlooks@gmail.com";

export function parseAttachments(raw: string | null): ChatAttachment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function mapMessage(row: any): ChatMessage | null {
  if (!row) return null;
  const replyTo = row.replyToId
    ? { id: row.replyToId, senderName: row.replyToSenderName || "Unknown", body: row.replyToBody || "" }
    : null;
  return {
    id: row.id,
    channelId: row.channelId,
    senderId: row.senderId,
    senderName: row.senderName || "Unknown",
    senderPicture: row.senderPicture ?? null,
    body: row.deletedAt ? "" : row.body,
    createdAt: row.createdAt,
    editedAt: row.editedAt ?? null,
    deletedAt: row.deletedAt ?? null,
    attachments: parseAttachments(row.attachments ?? null),
    replyToId: row.replyToId ?? null,
    replyTo,
  };
}
