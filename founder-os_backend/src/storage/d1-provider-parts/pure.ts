// Extracted verbatim from d1-provider.ts by scripts/refactor/split-module.mjs.
// d1-provider.ts re-exports everything public here, so existing imports keep working.
import type { StoredContact, StoredMessage, StoredEmail, StoredDigest, StoredTask, StoredChatPendingItem, StoredNote, StoredChatNote, AuditEntry } from "../interfaces";
import type { Row } from "./types";

export function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === 'string') return d;
  return d.toISOString();
}

export function parseDate(v: string | null | undefined): Date | null {
  return v ? new Date(v) : null;
}

export function toBool(v: number | null | undefined): boolean {
  return v === 1;
}

export function boolToInt(b: boolean | null | undefined): number {
  return b ? 1 : 0;
}

export function contactFromRow(r: Row): StoredContact {
  return {
    id: r.id as string,
    chatId: r.chatId as string,
    name: r.name as string,
    pushName: (r.pushName as string) ?? null,
    phoneNumber: r.phoneNumber as string,
    isGroup: toBool(r.isGroup as number),
    picture: (r.picture as string) ?? null,
    lastMessageAt: parseDate(r.lastMessageAt as string),
    lastMessageBody: (r.lastMessageBody as string) ?? null,
    unreadCount: (r.unreadCount as number) ?? 0,
    hasInbound: toBool(r.hasInbound as number),
    createdAt: new Date(r.createdAt as string),
    updatedAt: new Date(r.updatedAt as string),
  };
}

export function messageFromRow(r: Row): StoredMessage {
  return {
    id: r.id as string,
    chatId: r.chatId as string,
    sender: r.sender as string,
    body: r.body as string,
    timestamp: new Date(r.timestamp as string),
    processed: toBool(r.processed as number),
    wahaMessageId: (r.wahaMessageId as string) ?? null,
    isHistorical: toBool(r.isHistorical as number),
    mediaUrl: (r.mediaUrl as string) ?? null,
    quotedMessageId: (r.quotedMessageId as string) ?? null,
    quotedBody: (r.quotedBody as string) ?? null,
    quotedSender: (r.quotedSender as string) ?? null,
    classification: (r.classification as string) ?? null,
    classificationReason: (r.classificationReason as string) ?? null,
    classifiedAt: parseDate(r.classifiedAt as string),
    slaDeadline: parseDate(r.slaDeadline as string),
    createdAt: new Date(r.createdAt as string),
  };
}

export function emailFromRow(r: Row): StoredEmail {
  return {
    id: r.id as string,
    subject: r.subject as string,
    sender: r.sender as string,
    body: r.body as string,
    processed: toBool(r.processed as number),
    createdAt: new Date(r.createdAt as string),
  };
}

export function digestFromRow(r: Row): StoredDigest {
  return {
    id: r.id as string,
    chatId: r.chatId as string,
    chatName: r.chatName as string,
    summary: r.summary as string,
    priority: r.priority as string,
    category: r.category as string,
    sentiment: r.sentiment as string,
    requiresFounder: toBool(r.requiresFounder as number),
    suggestedReply: (r.suggestedReply as string) ?? null,
    createdAt: new Date(r.createdAt as string),
  };
}

export function taskFromRow(r: Row): StoredTask {
  return {
    id: r.id as string,
    title: r.title as string,
    owner: r.owner as string,
    status: r.status as string,
    deadline: parseDate(r.deadline as string),
    source: r.source as string,
    sourceId: (r.sourceId as string) ?? null,
    createdAt: new Date(r.createdAt as string),
  };
}

export function pendingFromRow(r: Row): StoredChatPendingItem {
  return {
    id: r.id as string,
    chatId: r.chatId as string,
    chatName: r.chatName as string,
    description: r.description as string,
    status: r.status as string,
    dueDate: parseDate(r.dueDate as string),
    sourceMessageId: (r.sourceMessageId as string) ?? null,
    resolvedBy: (r.resolvedBy as string) ?? null,
    createdAt: new Date(r.createdAt as string),
    resolvedAt: parseDate(r.resolvedAt as string),
  };
}

export function noteFromRow(r: Row): StoredNote {
  return { id: r.id as string, content: r.content as string, createdAt: new Date(r.createdAt as string) };
}

export function chatNoteFromRow(r: Row): StoredChatNote {
  return {
    chatId: r.chatId as string,
    content: r.content as string,
    createdAt: new Date(r.createdAt as string),
    updatedAt: new Date(r.updatedAt as string),
  };
}

export function auditFromRow(r: Row): AuditEntry {
  return {
    id: r.id as string,
    action: r.action as string,
    entityType: r.entityType as string,
    entityId: (r.entityId as string) ?? null,
    metadata: (r.metadata as string) ?? null,
    createdAt: new Date(r.createdAt as string),
  };
}
