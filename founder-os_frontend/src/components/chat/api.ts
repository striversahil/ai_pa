"use client";

import type { Channel, ChatMessage } from "./types";

/** Shared chat read helpers — keeps raw fetch calls in ONE allowed module
 *  (fe.raw_fetch_api ratchet) instead of scattered across components/hooks. */

const channelListeners = new Set<() => void>();

/**
 * Cross-hook notifier: ChatRoom calls this after any local action that can
 * change the channel list/unread (read/send/switch/mark-read); the global
 * unread badge in useChatUnread subscribes so it updates instantly instead
 * of waiting for its next poll (WS live is dead behind the Pages proxy).
 */
export function onChannelsChanged(fn: () => void): () => void {
  channelListeners.add(fn);
  return () => {
    channelListeners.delete(fn);
  };
}

export function notifyChannelsChanged(): void {
  channelListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

/**
 * Channel-list actions that can change unreads — typing/reactions/updates
 * never do, so they must not trigger a channel-list refetch (typing fires
 * every ~2s per typist and would storm the endpoint).
 */
export function chatListChanged(e: { type: string; action?: string }): boolean {
  return (
    e.type === "chat" &&
    (e.action === "created" || e.action === "channel-created" || e.action === "deleted")
  );
}

export async function fetchChannels(): Promise<Channel[]> {
  const res = await fetch("/api/chat/channels");
  if (!res.ok) throw new Error("load channels failed");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function fetchChannelMessages(
  channelId: string,
  before?: number,
  limit = 50,
): Promise<ChatMessage[]> {
  const q = before ? `?before=${before}&limit=${limit}` : `?limit=${limit}`;
  const res = await fetch(`/api/chat/channels/${channelId}/messages${q}`);
  if (!res.ok) throw new Error("load messages failed");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}
