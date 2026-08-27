import { ChatAttachment, ChatStore } from "./store";
import { isApproved } from "../auth/service";
import type { MeResponse } from "../auth/types";
import { LiveEvent } from "../../live";

export interface ChatResult {
  status: number;
  body: any;
  live?: { type: string; extra: Record<string, unknown> };
}

const json = (status: number, body: any): ChatResult => ({ status, body });

function err(message: string, status = 403): ChatResult {
  return json(status, { error: message });
}

function approved(me: MeResponse): boolean {
  return me.isAdmin || isApproved(me);
}

export async function chatListChannels(store: ChatStore, me: MeResponse): Promise<ChatResult> {
  const channels = await store.listChannelsWithUnread(me.user.id, me.isAdmin);
  return json(200, channels);
}

export async function chatListUsers(store: ChatStore, me: MeResponse): Promise<ChatResult> {
  const users = await store.listUsers();
  return json(200, users.filter((u) => u.id !== me.user.id));
}

export async function chatCreateChannel(
  store: ChatStore,
  me: MeResponse,
  payload: { name?: string; description?: string | null; category?: string | null; memberIds?: string[] },
): Promise<ChatResult> {
  if (!me.isAdmin) return err("Only admins can create channels");
  const name = (payload.name || "").trim();
  if (!name) return json(400, { error: "name required" });
  const memberIds = Array.isArray(payload.memberIds) ? payload.memberIds.filter(Boolean) : [];
  const channel = await store.createChannel({
    name,
    description: payload.description?.trim() || null,
    category: payload.category?.trim() || null,
    createdBy: me.user.id,
    memberIds,
  });
  return {
    status: 201,
    body: channel,
    live: { type: LiveEvent.Chat, extra: { action: "channel-created", channel } },
  };
}

export async function chatListChannelMembers(store: ChatStore, me: MeResponse, channelId: string): Promise<ChatResult> {
  if (!(await store.canAccessChannel(channelId, me.user.id, me.isAdmin))) return err("You don't have access to this channel");
  return json(200, await store.listChannelMembers(channelId));
}

export async function chatAddChannelMembers(store: ChatStore, me: MeResponse, channelId: string, userIds: string[]): Promise<ChatResult> {
  if (!me.isAdmin) return err("Only admins can manage members");
  if (!Array.isArray(userIds)) return json(400, { error: "userIds must be an array" });
  await store.addChannelMembers(channelId, userIds.filter(Boolean));
  return json(200, { ok: true });
}

export async function chatRemoveChannelMember(store: ChatStore, me: MeResponse, channelId: string, userId: string): Promise<ChatResult> {
  if (!me.isAdmin) return err("Only admins can manage members");
  await store.removeChannelMember(channelId, userId);
  return json(200, { ok: true });
}

export async function chatCreateDm(store: ChatStore, me: MeResponse, userId: string): Promise<ChatResult> {
  if (!userId) return json(400, { error: "userId required" });
  const channel = await store.createDm(me.user.id, userId);
  return {
    status: 201,
    body: channel,
    live: { type: LiveEvent.Chat, extra: { action: "channel-created", channel } },
  };
}

export async function chatListMessages(
  store: ChatStore,
  me: MeResponse,
  channelId: string,
  before: string | null,
  limit: string | null,
): Promise<ChatResult> {
  if (!(await store.canAccessChannel(channelId, me.user.id, me.isAdmin))) return err("You don't have access to this channel");
  const n = Math.min(parseInt(limit || "50", 10) || 50, 200);
  const b = before ? parseInt(before, 10) : null;
  return json(200, await store.listMessages(channelId, Number.isFinite(b as number) ? (b as number) : null, n));
}

export async function chatSendMessage(
  store: ChatStore,
  me: MeResponse,
  channelId: string,
  payload: { body?: string; attachments?: ChatAttachment[]; replyToId?: number | null },
): Promise<ChatResult> {
  if (!approved(me)) return err("Approval required before you can chat", 403);
  if (!(await store.canAccessChannel(channelId, me.user.id, me.isAdmin))) return err("You don't have access to this channel");
  const body = (payload.body || "").trim();
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  if (!body && attachments.length === 0) return json(400, { error: "body or attachment required" });
  const replyToId = payload.replyToId ? Number(payload.replyToId) : null;
  const message = await store.createMessage({ channelId, senderId: me.user.id, body, attachments, replyToId });
  return {
    status: 201,
    body: message,
    live: { type: LiveEvent.Chat, extra: { action: "created", channelId, message } },
  };
}

export async function chatMarkRead(
  store: ChatStore,
  me: MeResponse,
  channelId: string,
  lastReadId: number | null,
): Promise<ChatResult> {
  if (!(await store.canAccessChannel(channelId, me.user.id, me.isAdmin))) return err("You don't have access to this channel");
  if (lastReadId) await store.markChannelRead(me.user.id, channelId, lastReadId);
  return json(200, { ok: true });
}

export async function chatUpdateMessage(
  store: ChatStore,
  me: MeResponse,
  id: string,
  payload: { body?: string },
): Promise<ChatResult> {
  const msgId = parseInt(id, 10);
  if (!Number.isFinite(msgId)) return json(400, { error: "invalid id" });
  const existing = await store.getMessage(msgId);
  if (!existing) return json(404, { error: "message not found" });
  if (!(await store.canAccessChannel(existing.channelId, me.user.id, me.isAdmin))) return err("You don't have access to this channel");
  if (!me.isAdmin && existing.senderId !== me.user.id) return err("Only the author can edit this message");
  const body = (payload.body || "").trim();
  if (!body) return json(400, { error: "body required" });
  const message = await store.updateMessage(msgId, body);
  return {
    status: 200,
    body: message,
    live: { type: LiveEvent.Chat, extra: { action: "updated", channelId: existing.channelId, message } },
  };
}

export async function chatDeleteMessage(
  store: ChatStore,
  me: MeResponse,
  id: string,
): Promise<ChatResult> {
  const msgId = parseInt(id, 10);
  if (!Number.isFinite(msgId)) return json(400, { error: "invalid id" });
  const existing = await store.getMessage(msgId);
  if (!existing) return json(404, { error: "message not found" });
  if (!(await store.canAccessChannel(existing.channelId, me.user.id, me.isAdmin))) return err("You don't have access to this channel");
  if (!me.isAdmin && existing.senderId !== me.user.id) return err("Only the author can delete this message");
  await store.deleteMessage(msgId);
  return {
    status: 200,
    body: { ok: true },
    live: { type: LiveEvent.Chat, extra: { action: "deleted", channelId: existing.channelId, id: msgId } },
  };
}