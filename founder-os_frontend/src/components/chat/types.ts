"use client";

export interface Channel {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  type: "channel" | "dm";
  createdAt: string;
  otherUser?: { id: string; name: string; picture: string | null; email?: string | null } | null;
  unread?: number;
}

export interface ChatUser {
  id: string;
  name: string;
  picture: string | null;
  email?: string | null;
}

export interface ChatAttachment {
  key: string;
  name: string;
  size: number;
  type: string;
}

export interface ChatMessage {
  id: number;
  channelId: string;
  senderId: string;
  senderName: string;
  senderPicture: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  attachments: ChatAttachment[];
  replyToId?: number | null;
  replyTo?: { id: number; senderName: string; body: string } | null;
}

export interface ChatReaction {
  messageId: number;
  emoji: string;
  userId: string;
  userName: string;
}

export type LiveChatEvent = {
  type: string;
  action?: string;
  channelId?: string;
  message?: ChatMessage;
  id?: number;
  userId?: string;
  userName?: string;
  messageId?: number;
  reactions?: ChatReaction[];
};

export function upsert(list: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const i = list.findIndex((m) => m.id === msg.id);
  if (i >= 0) {
    const c = [...list];
    c[i] = msg;
    return c;
  }
  return [...list, msg];
}

export function mergeFromServer(list: ChatMessage[], server: ChatMessage[], channelId: string): ChatMessage[] {
  const map = new Map<number, ChatMessage>();
  for (const m of list) if (m.channelId === channelId) map.set(m.id, m);
  for (const m of server) map.set(m.id, m);
  return [...map.values()].sort((a, b) => a.id - b.id);
}

export function timeLabel(iso: string, clock24h = false): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: !clock24h });
}

export function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

export function dayDividerLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function isPpt(a: ChatAttachment): boolean {
  return /powerpoint|presentationml/.test(a.type) || /\.pptx?$/i.test(a.name);
}

const AVATAR_COLORS = ["#5865f2", "#23a55a", "#f0b232", "#ed4245", "#3ba3db", "#9b59b6", "#e91e63", "#8bc34a"];

export function userColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
