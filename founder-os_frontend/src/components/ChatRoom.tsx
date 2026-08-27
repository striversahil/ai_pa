"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLiveQuery, useLiveEvent } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import { Hash, Plus, Send, Pencil, Trash2, MessagesSquare, Paperclip, FileText, X, CornerDownRight, Users } from "lucide-react";
import Lightbox from "@/components/Lightbox";

interface Channel {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  type: "channel" | "dm";
  createdAt: string;
  otherUser?: { id: string; name: string; picture: string | null } | null;
  unread?: number;
}

interface ChatUser {
  id: string;
  name: string;
  picture: string | null;
}

interface ChatAttachment {
  key: string;
  name: string;
  size: number;
  type: string;
}

interface ChatMessage {
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

type LiveChatEvent = { type: string; action?: string; channelId?: string; message?: ChatMessage; id?: number; userId?: string; userName?: string };

function upsert(list: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const i = list.findIndex((m) => m.id === msg.id);
  if (i >= 0) {
    const c = [...list];
    c[i] = msg;
    return c;
  }
  return [...list, msg];
}

function mergeFromServer(list: ChatMessage[], server: ChatMessage[], channelId: string): ChatMessage[] {
  const map = new Map<number, ChatMessage>();
  for (const m of list) if (m.channelId === channelId) map.set(m.id, m);
  for (const m of server) map.set(m.id, m);
  return [...map.values()].sort((a, b) => a.id - b.id);
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatRoom() {
  const { me, canView } = useAuth();
  const isAdmin = me?.isAdmin ?? false;
  const isApproved = canView("chat");

  const channels = useLiveQuery<Channel[]>(
    async () => {
      const res = await fetch("/api/chat/channels");
      if (!res.ok) throw new Error("load channels failed");
      return res.json();
    },
    // Only refresh the rail on channel-created (new DM/channel); message and
    // typing events must NOT trigger a full list + unread recount.
    { events: (e) => e.type === "chat" && e.action === "channel-created" },
  );

  const [channelId, setChannelId] = useState<string | null>(null);
  const selectedId = channelId ?? (channels.data ?? [])[0]?.id ?? null;

  // Per-channel message cache so switching between chats is instant (no fetch
  // per click). Keyed by channel id; holds all loaded pages. `hasMore` per
  // channel drives the load-older control.
  const msgsCache = useRef<Map<string, ChatMessage[]>>(new Map());
  const hasMoreCache = useRef<Map<string, boolean>>(new Map());
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [msgsLoading, setMsgsLoading] = useState(false);

  const fetchChannelMessages = async (id: string, opts: { silent?: boolean; before?: number } = {}) => {
    const q = opts.before ? `?before=${opts.before}&limit=50` : "?limit=50";
    const res = await fetch(`/api/chat/channels/${id}/messages${q}`);
    if (!res.ok) throw new Error("load messages failed");
    const data = await res.json();
    const list = Array.isArray(data) ? data : [];
    if (opts.before) {
      const cached = msgsCache.current.get(id) || [];
      const byId = new Map<number, ChatMessage>();
      for (const m of [...list, ...cached]) byId.set(m.id, m);
      const merged = [...byId.values()].sort((a, b) => a.id - b.id);
      msgsCache.current.set(id, merged);
      hasMoreCache.current.set(id, list.length >= 50);
      if (id === selectedId) {
        setMsgs(merged);
        setHasMore(list.length >= 50);
      }
    } else {
      const sorted = [...list].sort((a, b) => a.id - b.id);
      msgsCache.current.set(id, sorted);
      hasMoreCache.current.set(id, list.length >= 50);
      if (id === selectedId) {
        setMsgs(sorted);
        setHasMore(list.length >= 50);
      }
    }
    return list;
  };

  const markChannelRead = (channelId: string) => {
    const all = msgsCache.current.get(channelId) || [];
    const maxId = all.reduce((m, x) => Math.max(m, x.id), 0);
    if (maxId <= 0) return;
    // Fire-and-forget; no list refresh here (opening a channel already
    // refreshes via the selectedId effect, and the local badge is zeroed by
    // the re-render since unread derives from the fetched list).
    fetch(`/api/chat/channels/${channelId}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastReadId: maxId }),
    }).catch(() => {});
  };

  // Switch channel: render cached instantly, then silently refresh.
  useEffect(() => {
    if (!selectedId) return;
    const cached = msgsCache.current.get(selectedId);
    if (cached && cached.length > 0) {
      setMsgs(cached);
      setHasMore(!!hasMoreCache.current.get(selectedId));
    } else {
      setMsgs([]);
      setMsgsLoading(true);
    }
    fetchChannelMessages(selectedId, { silent: true })
      .then(() => {
        markChannelRead(selectedId);
        // Clear this channel's unread badge in the rail once.
        channels.refresh();
      })
      .catch(() => {})
      .finally(() => setMsgsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useLiveEvent((e) => {
    const ev = e as LiveChatEvent;
    if (ev.type !== "chat" || !selectedId) return;
    // Debounce a background refresh when this channel changes live; cache and
    // visible list are both reconciled from the fetch.
    if (ev.channelId === selectedId) {
      if (ev.action === "created" && ev.message) {
        setMsgs((prev) => upsert(prev, ev.message!));
        msgsCache.current.set(selectedId, upsert(msgsCache.current.get(selectedId) || [], ev.message!));
        // Sender stopped typing once their message lands.
        expireTyping(selectedId, ev.message.senderId);
        // We're viewing this channel — keep it marked as seen.
        markChannelRead(selectedId);
      } else if (ev.action === "updated" && ev.message) {
        setMsgs((prev) => upsert(prev, ev.message!));
        msgsCache.current.set(selectedId, upsert(msgsCache.current.get(selectedId) || [], ev.message!));
      } else if (ev.action === "deleted" && ev.id != null) {
        const mark = (m: ChatMessage) => (m.id === ev.id ? { ...m, deletedAt: new Date().toISOString() } : m);
        setMsgs((prev) => prev.map(mark));
        msgsCache.current.set(selectedId, (msgsCache.current.get(selectedId) || []).map(mark));
      } else if (ev.action === "typing" && ev.userId && ev.userId !== me?.user.id && ev.userName) {
        const uid = ev.userId;
        setTypingUsers((prev) => {
          const map = { ...(prev[selectedId] || {}) };
          map[uid] = { name: ev.userName!, until: Date.now() + 3000 };
          return { ...prev, [selectedId]: map };
        });
        if (typingTimers.current[uid]) clearTimeout(typingTimers.current[uid]);
        typingTimers.current[uid] = setTimeout(() => expireTyping(selectedId, uid), 3200);
      } else if (ev.action === "created") {
        void fetchChannelMessages(selectedId, { silent: true }).catch(() => {});
      }
    } else if (ev.action === "channel-created") {
      channels.refresh();
    }
    // New message in a NON-active channel → bump its unread badge. Active
    // channel is already marked read by markChannelRead, so no refresh needed.
    if (ev.action === "created" && ev.message && ev.channelId !== selectedId) {
      channels.refresh();
    }
  });

  const [composer, setComposer] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);

  // ── Typing indicators ──────────────────────────────────────────────────────
  // typingUsers: channelId → Map<userId, {name, until}> (auto-expires ~3s).
  const [typingUsers, setTypingUsers] = useState<Record<string, Record<string, { name: string; until: number }>>>({});
  const lastTypingSent = useRef<Record<string, number>>({});
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const notifyTyping = () => {
    if (!selectedId) return;
    const now = Date.now();
    if (now - (lastTypingSent.current[selectedId] || 0) < 2000) return; // throttle
    lastTypingSent.current[selectedId] = now;
    fetch("/api/chat/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId: selectedId }),
    }).catch(() => {});
  };

  const expireTyping = (channelId: string, userId: string) => {
    setTypingUsers((prev) => {
      const map = { ...(prev[channelId] || {}) };
      delete map[userId];
      return { ...prev, [channelId]: map };
    });
  };
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState("");
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [showDmPicker, setShowDmPicker] = useState(false);
  const [dmUsers, setDmUsers] = useState<ChatUser[]>([]);
  const [newMemberIds, setNewMemberIds] = useState<string[]>([]);
  const [manageChannel, setManageChannel] = useState<Channel | null>(null);
  const [channelMembers, setChannelMembers] = useState<ChatUser[]>([]);
  const [railOpen, setRailOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [viewer, setViewer] = useState<{ url: string; type: string; name: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const touchMoveX = useRef<number | null>(null);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    setDragging(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (dropped.length > 0) setFiles((p) => [...p, ...dropped]);
  };

  const openImages = (m: ChatMessage, key: string) => {
    const images = m.attachments.filter((a) => a.type.startsWith("image/")).map((a) => `/api/chat/files/${a.key}`);
    const index = images.findIndex((u) => u.endsWith(key));
    setLightbox({ images, index: index >= 0 ? index : 0 });
  };

  const isPpt = (a: ChatAttachment) => /powerpoint|presentationml/.test(a.type) || /\.pptx?$/i.test(a.name);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [msgs.length, selectedId, scrollToBottom]);

  // Newly created channels (DM/new) that may not be in channels.data yet —
  // keeps the header + list responsive immediately after creation.
  const freshChannel = useRef<Channel | null>(null);

  const active = freshChannel.current?.id === selectedId
    ? freshChannel.current
    : (channels.data ?? []).find((c) => c.id === selectedId) || null;

  const grouped = useMemo(() => {
    const map = new Map<string, Channel[]>();
    for (const c of channels.data ?? []) {
      if (c.type !== "channel") continue;
      const key = c.category || "General";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return [...map.entries()];
  }, [channels.data]);

  const dms = (channels.data ?? []).filter((c) => c.type === "dm");

  // Once the refreshed list includes the freshly-created channel, stop
  // special-casing it so the header uses the canonical list entry.
  useEffect(() => {
    if (freshChannel.current && (channels.data ?? []).some((c) => c.id === freshChannel.current!.id)) {
      freshChannel.current = null;
    }
  }, [channels.data]);

  const send = async () => {
    const body = composer.trim();
    const pendingFiles = files;
    if ((!body && pendingFiles.length === 0) || !selectedId || sending) return;
    setSending(true);
    const tempId = -Date.now();
    const temp: ChatMessage = {
      id: tempId,
      channelId: selectedId,
      senderId: me?.user.id ?? "",
      senderName: me?.user.name ?? "You",
      senderPicture: me?.user.picture ?? null,
      body,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      attachments: [],
    };
    setMsgs((prev) => upsert(prev, temp));
    msgsCache.current.set(selectedId, upsert(msgsCache.current.get(selectedId) || [], temp));
    setComposer("");
    setFiles([]);
    try {
      const attachments: ChatAttachment[] = [];
      for (const f of pendingFiles) {
        const fd = new FormData();
        fd.append("file", f);
        const up = await fetch("/api/chat/files", { method: "POST", body: fd });
        const a = await up.json();
        if (!up.ok) throw new Error(a.error || "upload failed");
        attachments.push({ key: a.key, name: a.name, size: a.size, type: a.type });
      }
      const res = await fetch(`/api/chat/channels/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, attachments, replyToId: replyTo?.id ?? null }),
      });
      const real = await res.json();
      if (!res.ok) throw new Error(real.error || "send failed");
      setReplyTo(null);
      setMsgs((prev) => prev.filter((m) => m.id !== tempId).concat([real]));
      msgsCache.current.set(selectedId, (msgsCache.current.get(selectedId) || []).filter((m) => m.id !== tempId).concat([real]));
    } catch {
      setMsgs((prev) => prev.filter((m) => m.id !== tempId));
      msgsCache.current.set(selectedId, (msgsCache.current.get(selectedId) || []).filter((m) => m.id !== tempId));
      setFiles(pendingFiles);
    } finally {
      setSending(false);
    }
  };

  const loadOlder = async () => {
    const cached = msgsCache.current.get(selectedId) || [];
    const oldest = [...cached].sort((a, b) => a.id - b.id)[0];
    if (!oldest || loadingOlder || !hasMoreCache.current.get(selectedId)) return;
    setLoadingOlder(true);
    try {
      const res = await fetch(`/api/chat/channels/${selectedId}/messages?before=${oldest.id}&limit=50`);
      if (!res.ok) throw new Error("load older failed");
      const older = await res.json();
      const merged = mergeFromServer(cached, older, selectedId);
      msgsCache.current.set(selectedId, merged);
      hasMoreCache.current.set(selectedId, (older?.length ?? 0) >= 50);
      setMsgs(merged);
      setHasMore((older?.length ?? 0) >= 50);
    } catch { /* ignore */ }
    setLoadingOlder(false);
  };

  const canModify = (m: ChatMessage) => isAdmin || m.senderId === me?.user.id;

  const saveEdit = async () => {
    if (!editing) return;
    const body = editText.trim();
    if (!body) return;
    try {
      const res = await fetch(`/api/chat/messages/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error || "edit failed");
      setMsgs((prev) => upsert(prev, updated));
      msgsCache.current.set(selectedId, upsert(msgsCache.current.get(selectedId) || [], updated));
    } catch { /* ignore */ }
    setEditing(null);
    setEditText("");
  };

  const del = async (m: ChatMessage) => {
    if (!confirm("Delete this message?")) return;
    try {
      await fetch(`/api/chat/messages/${m.id}`, { method: "DELETE" });
      const mark = (x: ChatMessage) => (x.id === m.id ? { ...x, deletedAt: new Date().toISOString() } : x);
      setMsgs((prev) => prev.map(mark));
      msgsCache.current.set(selectedId, (msgsCache.current.get(selectedId) || []).map(mark));
    } catch { /* ignore */ }
  };

  const createChannel = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/chat/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category: newCategory.trim() || null, description: newDesc.trim() || null, memberIds: newMemberIds }),
      });
      const ch = await res.json();
      if (!res.ok) throw new Error(ch.error || "create failed");
      setNewName(""); setNewCategory(""); setNewDesc(""); setNewMemberIds([]);
      setShowNewChannel(false);
      freshChannel.current = ch;
      setChannelId(ch.id);
      setMsgs([]);
    } catch { /* ignore */ }
    setCreating(false);
  };

  const openDmPicker = async () => {
    setShowDmPicker(true);
    try {
      const res = await fetch("/api/chat/users");
      if (res.ok) setDmUsers(await res.json());
    } catch { /* ignore */ }
  };

  const startDm = async (userId: string) => {
    try {
      const res = await fetch("/api/chat/dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const ch = await res.json();
      if (!res.ok) throw new Error(ch.error || "failed to start DM");
      setShowDmPicker(false);
      freshChannel.current = ch;
      setChannelId(ch.id);
      setMsgs([]);
      // No explicit refresh here: the `channel-created` live event re-fetches the
      // rail, and messages load via the selectedId effect. Avoids duplicate work.
    } catch { /* ignore */ }
  };

  const openManageMembers = async (ch: Channel) => {
    setManageChannel(ch);
    try {
      const [m, u] = await Promise.all([
        fetch(`/api/chat/channels/${ch.id}/members`).then((r) => r.json()),
        fetch("/api/chat/users").then((r) => r.json()),
      ]);
      setChannelMembers(Array.isArray(m) ? m : []);
      setDmUsers(Array.isArray(u) ? u : []);
    } catch { /* ignore */ }
  };

  const addMember = async (userId: string) => {
    if (!manageChannel) return;
    try {
      const res = await fetch(`/api/chat/channels/${manageChannel.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [userId] }),
      });
      if (res.ok) {
        const user = dmUsers.find((x) => x.id === userId);
        if (user) setChannelMembers((prev) => [...prev, user]);
      }
    } catch { /* ignore */ }
  };

  const removeMember = async (userId: string) => {
    if (!manageChannel) return;
    try {
      const res = await fetch(`/api/chat/channels/${manageChannel.id}/members/${userId}`, { method: "DELETE" });
      if (res.ok) setChannelMembers((prev) => prev.filter((x) => x.id !== userId));
    } catch { /* ignore */ }
  };

  if (!isApproved) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-zinc-500">
        Your account has no access yet. Ask the administrator to grant access.
      </div>
    );
  }

  return (
    <div className="relative flex h-[calc(100vh-8rem)] min-h-[480px] overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}>
      {/* Channel rail — drawer on mobile, static column on md+ */}
      <aside className={`${
          railOpen ? "flex" : "hidden"
        } absolute inset-y-0 left-0 z-20 w-64 flex-col border-r border-zinc-200 bg-zinc-100/95 shadow-xl dark:border-zinc-800 dark:bg-zinc-950/95 md:static md:z-auto md:flex md:w-60 md:shadow-none md:bg-zinc-100/70 dark:md:bg-zinc-950/50`}>
        <div className="px-3 pt-3 pb-2">
          <button onClick={() => void openDmPicker()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-bold text-white shadow-md shadow-indigo-600/30 transition hover:bg-indigo-500 cursor-pointer">
            <Plus className="h-4 w-4" /> New chat
          </button>
        </div>
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-xs font-extrabold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Channels</span>
          <div className="flex items-center gap-1">
            {isAdmin && (
              <button onClick={() => setShowNewChannel((v) => !v)} title="New channel"
                className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white">
                <Plus className="h-4 w-4" />
              </button>
            )}
            <button onClick={() => setRailOpen(false)} title="Close channel list"
              className="rounded-md p-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white md:hidden">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {showNewChannel && isAdmin && (
          <div className="mx-3 mb-3 space-y-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-3">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Channel name" autoFocus
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-2 py-1.5 text-sm" />
            <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Category (e.g. Operations)"
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-2 py-1.5 text-sm" />
            <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Description (optional)"
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-2 py-1.5 text-sm" />
            <div className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 p-2">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Add members</div>
              <div className="max-h-24 space-y-1 overflow-y-auto">
                {dmUsers.length === 0 ? (
                  <p className="text-xs text-zinc-500">Loading members…</p>
                ) : (
                  dmUsers.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 py-0.5 text-xs cursor-pointer">
                      <input type="checkbox" checked={newMemberIds.includes(u.id)}
                        onChange={() => setNewMemberIds((prev) => prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id])}
                        className="accent-indigo-500" />
                      <span className="truncate">{u.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <button onClick={createChannel} disabled={creating}
              className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">
              Create
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {dms.length > 0 && (
            <div className="mb-3">
              <div className="px-1 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Direct Messages</div>
              {dms.map((c) => (
                <button key={c.id} onClick={() => { setChannelId(c.id); setMsgs([]); setRailOpen(false); }}
                  className={`mb-0.5 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium transition ${
                    selectedId === c.id
                      ? "bg-indigo-600/15 text-indigo-700 dark:text-indigo-300"
                      : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                  }`}>
                  {c.otherUser?.picture ? (
                    <img src={c.otherUser.picture} alt="" className="h-5 w-5 shrink-0 rounded-full" />
                  ) : (
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600/20 text-[10px] font-bold text-emerald-400">
                      {(c.otherUser?.name || "?").charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="truncate">{c.otherUser?.name || c.name}</span>
                  {!!c.unread && (
                    <span className="ml-auto shrink-0 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {c.unread > 99 ? "99+" : c.unread}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {grouped.map(([cat, list]) => (
            <div key={cat} className="mb-3">
              <div className="px-1 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">{cat}</div>
              {list.map((c) => (
                <button key={c.id} onClick={() => { setChannelId(c.id); setMsgs([]); setRailOpen(false); }}
                  className={`mb-0.5 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium transition ${
                    channelId === c.id || selectedId === c.id
                      ? "bg-indigo-600/15 text-indigo-700 dark:text-indigo-300"
                      : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                  }`}>
                  <Hash className="h-4 w-4 shrink-0 opacity-60" />
                  <span className="truncate">{c.name}</span>
                  {!!c.unread && (
                    <span className="ml-auto shrink-0 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {c.unread > 99 ? "99+" : c.unread}
                    </span>
                  )}
                  {isAdmin && (
                    <button onClick={(e) => { e.stopPropagation(); void openManageMembers(c); }}
                      className="shrink-0 rounded p-0.5 text-zinc-400 hover:text-indigo-400" title="Manage members">
                      <Users className="h-3.5 w-3.5" />
                    </button>
                  )}
                </button>
              ))}
            </div>
          ))}
          {(channels.data ?? []).length === 0 && (
            <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">No channels yet. An admin can create one.</p>
          )}
        </div>
      </aside>

      {/* Main pane */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
          <button onClick={() => setRailOpen(true)} title="Channel list"
            className="rounded-lg bg-zinc-100 dark:bg-zinc-800 p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white md:hidden">
            <Hash className="h-4 w-4" />
          </button>
          {active?.type === "dm" ? (
            active.otherUser?.picture ? (
              <img src={active.otherUser.picture} alt="" className="h-6 w-6 rounded-full" />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600/20 text-xs font-bold text-emerald-400">
                {(active.otherUser?.name || "?").charAt(0).toUpperCase()}
              </div>
            )
          ) : (
            <Hash className="h-5 w-5 text-zinc-400" />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">
              {active ? (active.type === "dm" ? active.otherUser?.name || "Direct Message" : active.name) : "Select a channel"}
            </div>
            {active?.description && <div className="truncate text-xs text-zinc-500">{active.description}</div>}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {msgsLoading && msgs.length === 0 && (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              <span className="animate-pulse">Loading messages…</span>
            </div>
          )}
          {hasMore && !msgsLoading && (
            <div className="mb-3 text-center">
              <button onClick={loadOlder} disabled={loadingOlder}
                className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-60">
                {loadingOlder ? "Loading…" : "Load older messages"}
              </button>
            </div>
          )}
          {msgs.length === 0 && !msgsLoading && (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              <MessagesSquare className="mr-2 h-5 w-5" /> Be the first to say something here.
            </div>
          )}
          <div className="space-y-3">
            {msgs.map((m) => {
              const own = m.senderId === me?.user.id;
              return (
                <div key={m.id}
                  className={`group relative flex gap-3 ${own ? "justify-end" : ""}`}
                  onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
                  onTouchMove={(e) => { touchMoveX.current = e.touches[0].clientX; }}
                  onTouchEnd={() => {
                    const dx = (touchMoveX.current ?? 0) - (touchStartX.current ?? 0);
                    touchStartX.current = null;
                    touchMoveX.current = null;
                    // Right-swipe (~60px) = reply to this message (mobile).
                    if (dx > 60) { setReplyTo(m); composerRef.current?.focus(); }
                  }}
                >
                  {!own && (
                    m.senderPicture ? (
                      <img src={m.senderPicture} alt="" className="h-9 w-9 shrink-0 rounded-full" />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600/20 text-sm font-bold text-indigo-400">
                        {m.senderName.charAt(0).toUpperCase()}
                      </div>
                    )
                  )}
                  <div className={`relative max-w-[70%] ${own ? "text-right" : ""}`}>
                    {!own && (
                      <div className="mb-0.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300">{m.senderName}</div>
                    )}
                    {!m.deletedAt && m.attachments.length > 0 && (
                      <div className={`mb-1.5 flex flex-col gap-1.5 ${own ? "items-end" : "items-start"}`}>
                        {m.attachments.map((a) => {
                          const url = `/api/chat/files/${a.key}`;
                          if (a.type.startsWith("image/")) {
                            return (
                              <button key={a.key} onClick={() => openImages(m, a.key)} title={a.name}
                                className="cursor-zoom-in rounded-lg p-0 transition hover:opacity-90">
                                <img src={url} alt={a.name}
                                  className="max-h-60 rounded-lg border border-zinc-200 dark:border-zinc-700" />
                              </button>
                            );
                          }
                          if (a.type === "application/pdf") {
                            return (
                              <button key={a.key} onClick={() => setViewer({ url, type: a.type, name: a.name })}
                                className="cursor-zoom-in overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 text-left transition hover:opacity-90">
                                <iframe src={url} title={a.name} className="pointer-events-none h-64 w-full max-w-md" />
                                <span className={`flex items-center gap-2 px-3 py-1.5 text-xs ${own ? "bg-indigo-700/40 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200"}`}>
                                  <FileText className="h-4 w-4 shrink-0" />
                                  <span className="truncate">{a.name}</span>
                                  <span className={`ml-auto ${own ? "text-white/70" : "text-zinc-400"}`}>{formatBytes(a.size)} · click to view</span>
                                </span>
                              </button>
                            );
                          }
                          if (a.type.startsWith("video/")) {
                            return (
                              <video key={a.key} src={url} controls preload="metadata"
                                onClick={() => setViewer({ url, type: a.type, name: a.name })}
                                className="max-h-80 max-w-md cursor-pointer rounded-lg border border-zinc-200 dark:border-zinc-700" />
                            );
                          }
                          if (a.type.startsWith("audio/")) {
                            return (
                              <div key={a.key} className={`flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                                own ? "border-white/25 bg-indigo-700/40" : "border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800"
                              }`}>
                                <audio controls src={url} preload="metadata" className="h-9 max-w-[220px]" />
                                <span className={`min-w-0 text-xs ${own ? "text-white" : "text-zinc-700 dark:text-zinc-200"}`}>
                                  <span className="block truncate">{a.name}</span>
                                  <span className={`${own ? "text-white/70" : "text-zinc-400"}`}>{formatBytes(a.size)}</span>
                                </span>
                              </div>
                            );
                          }
                          if (a.type.startsWith("text/") || isPpt(a)) {
                            return (
                              <button key={a.key} onClick={() => setViewer({ url, type: a.type, name: a.name })}
                                className={`flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs transition hover:opacity-80 ${
                                  own
                                    ? "border-white/25 bg-indigo-700/40 text-white"
                                    : "border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
                                }`}>
                                <FileText className="h-4 w-4 shrink-0 text-amber-500" />
                                <span className="truncate">{a.name}</span>
                                <span className={`ml-1 shrink-0 ${own ? "text-white/70" : "text-zinc-400"}`}>{formatBytes(a.size)} · view</span>
                              </button>
                            );
                          }
                          return (
                            <a key={a.key} href={url} download={a.name}
                              className={`flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs transition hover:opacity-80 ${
                                own
                                  ? "border-white/25 bg-indigo-700/40 text-white"
                                  : "border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
                              }`}>
                              <FileText className="h-4 w-4 shrink-0" />
                              <span className="truncate">{a.name}</span>
                              <span className={`ml-1 shrink-0 ${own ? "text-white/70" : "text-zinc-400"}`}>{formatBytes(a.size)}</span>
                            </a>
                          );
                        })}
                      </div>
                    )}
                    <div className={`inline-block rounded-2xl px-3 py-2 text-left text-sm break-words ${
                      own
                        ? "bg-indigo-600 text-white"
                        : "bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                    }`}>
                      {m.deletedAt ? (
                        <span className="italic opacity-70">(message deleted)</span>
                      ) : (
                        <>
                          {m.replyTo && (
                            <div className={`mb-1.5 rounded-lg border-l-4 px-2.5 py-1.5 text-xs ${
                              own ? "border-white/40 bg-white/10" : "border-indigo-400 bg-zinc-300/40 dark:bg-zinc-700/40"
                            }`}>
                              <div className={`font-bold ${own ? "text-white/80" : "text-indigo-500 dark:text-indigo-300"}`}>{m.replyTo.senderName}</div>
                              <div className={`truncate ${own ? "text-white/70" : "text-zinc-500 dark:text-zinc-400"}`}>{m.replyTo.body || "(attachment)"}</div>
                            </div>
                          )}
                          {m.body}
                          {m.editedAt && <span className={`ml-1 text-[10px] opacity-60 ${own ? "text-white/70" : ""}`}>(edited)</span>}
                        </>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-400">
                      <span>{timeLabel(m.createdAt)}</span>
                      <button onClick={() => { setReplyTo(m); composerRef.current?.focus(); }}
                        className="opacity-0 transition group-hover:opacity-100 hover:text-indigo-400" title="Reply">
                        <CornerDownRight className="h-3 w-3" />
                      </button>
                      {canModify(m) && !m.deletedAt && (
                        <>
                          <button onClick={() => { setEditing(m); setEditText(m.body); }}
                            className="opacity-0 transition group-hover:opacity-100 hover:text-indigo-400" title="Edit">
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button onClick={() => del(m)} className="opacity-0 transition group-hover:opacity-100 hover:text-rose-400" title="Delete">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div ref={bottomRef} />
        </div>

        <footer className="border-t border-zinc-200 dark:border-zinc-800 p-3">
          {editing ? (
            <div className="flex items-center gap-2">
              <input value={editText} onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void saveEdit(); if (e.key === "Escape") { setEditing(null); setEditText(""); } }}
                autoFocus
                className="flex-1 rounded-xl border border-indigo-500/50 bg-zinc-100 dark:bg-zinc-800 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500/40" />
              <button onClick={saveEdit} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">Save</button>
              <button onClick={() => { setEditing(null); setEditText(""); }} className="rounded-xl bg-zinc-200 dark:bg-zinc-700 px-4 py-2.5 text-sm font-semibold">Cancel</button>
            </div>
          ) : (
            <>
              {(() => {
                const typers = Object.values(typingUsers[selectedId || ""] || {})
                  .filter((t) => t.until > Date.now());
                if (typers.length === 0) return null;
                const names = typers.map((t) => t.name);
                const label = names.length === 1
                  ? `${names[0]} is typing`
                  : `${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""} are typing`;
                return (
                  <div className="mb-1.5 flex items-center gap-2 px-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="flex gap-0.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce" />
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:120ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:240ms]" />
                    </span>
                    <span className="italic">{label}…</span>
                  </div>
                );
              })()}
              {files.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {files.map((f, i) => (
                    <div key={`${f.name}-${i}`}
                      className="flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-700 dark:text-zinc-200">
                      <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                      <span className="max-w-[160px] truncate">{f.name}</span>
                      <span className="text-zinc-400">{formatBytes(f.size)}</span>
                      <button onClick={() => setFiles((p) => p.filter((_, x) => x !== i))} className="text-zinc-400 hover:text-rose-400" title="Remove">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {replyTo && (
                <div className="mb-1.5 flex items-center gap-2 rounded-lg border-l-4 border-indigo-400 bg-indigo-500/10 px-2.5 py-1.5 text-xs text-zinc-700 dark:text-zinc-200">
                  <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                  <span className="min-w-0">
                    <span className="font-bold text-indigo-500 dark:text-indigo-300">Replying to {replyTo.senderName}:</span>{" "}
                    <span className="truncate">{replyTo.body || "(attachment)"}</span>
                  </span>
                  <button onClick={() => setReplyTo(null)} className="ml-auto shrink-0 text-zinc-400 hover:text-rose-400" title="Cancel reply">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    setFiles((p) => [...p, ...picked]);
                    e.target.value = "";
                  }}
                />
                <button onClick={() => fileInputRef.current?.click()} disabled={!selectedId}
                  className="rounded-xl bg-zinc-200 dark:bg-zinc-700 p-2.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600 disabled:opacity-50" title="Attach image or document">
                  <Paperclip className="h-4 w-4" />
                </button>
                <input
                  ref={composerRef}
                  value={composer}
                  onChange={(e) => { setComposer(e.target.value); notifyTyping(); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  placeholder={active ? `Message #${active.name}` : "Select a channel to chat"}
                  disabled={!selectedId}
                  className="flex-1 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
                />
                <button onClick={() => void send()} disabled={!selectedId || (!composer.trim() && files.length === 0) || sending}
                  className="rounded-xl bg-indigo-600 p-2.5 text-white hover:bg-indigo-500 disabled:opacity-50" title="Send">
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </footer>
      </main>

      {lightbox && (
        <Lightbox
          image={lightbox.images[lightbox.index] ?? null}
          images={lightbox.images}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}

      {viewer && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs animate-fade-in"
          onClick={() => setViewer(null)}>
          <button
            className="absolute top-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white transition-colors hover:text-zinc-400"
            onClick={() => setViewer(null)} type="button" title="Close">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="flex max-h-[92vh] max-w-[95vw] flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {viewer.type === "application/pdf" || viewer.type.startsWith("text/") ? (
              <iframe src={viewer.url} title={viewer.name} className="h-[85vh] w-[90vw] rounded-lg border border-white/10 bg-white" />
            ) : viewer.type.startsWith("video/") ? (
              <video src={viewer.url} controls autoPlay className="max-h-[85vh] max-w-[90vw] rounded-lg" />
            ) : viewer.type.startsWith("audio/") ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-zinc-900 p-8">
                <audio src={viewer.url} controls autoPlay className="w-[60vw] max-w-md" />
              </div>
            ) : /powerpoint|presentationml/.test(viewer.type) || /\.pptx?$/i.test(viewer.name) ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-zinc-900 p-10 text-center">
                <FileText className="h-12 w-12 text-amber-500" />
                <p className="font-semibold text-white">{viewer.name}</p>
                <p className="max-w-sm text-sm text-white/60">
                  PowerPoint preview isn't available on this platform yet — download the file to view it.
                </p>
                <a href={viewer.url} download={viewer.name}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
                  Download
                </a>
              </div>
            ) : (
              <a href={viewer.url} download={viewer.name}
                className="rounded-xl border border-white/10 bg-zinc-900 px-6 py-4 text-sm font-semibold text-white hover:bg-zinc-800">
                Download {viewer.name}
              </a>
            )}
            <span className="rounded-full bg-black/50 px-3 py-1 text-xs font-semibold text-white">{viewer.name}</span>
          </div>
        </div>
      )}

      {showDmPicker && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={() => setShowDmPicker(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-zinc-900 dark:text-white">New message</h3>
              <button onClick={() => setShowDmPicker(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" title="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {dmUsers.map((u) => (
                <button key={u.id} onClick={() => void startDm(u.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  {u.picture ? (
                    <img src={u.picture} alt="" className="h-8 w-8 rounded-full" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600/20 text-sm font-bold text-emerald-400">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="truncate font-medium text-zinc-800 dark:text-zinc-100">{u.name}</span>
                </button>
              ))}
              {dmUsers.length === 0 && (
                <p className="px-3 py-2 text-sm text-zinc-500">No other members yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {manageChannel && isAdmin && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={() => setManageChannel(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-zinc-900 dark:text-white">Manage #{manageChannel.name}</h3>
              <button onClick={() => setManageChannel(null)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" title="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Members ({channelMembers.length})</p>
            <div className="mb-3 max-h-48 space-y-1 overflow-y-auto">
              {channelMembers.map((u) => (
                <div key={u.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                  <span className="truncate font-medium text-zinc-800 dark:text-zinc-100">{u.name}</span>
                  <button onClick={() => void removeMember(u.id)}
                    className="ml-auto shrink-0 rounded p-0.5 text-zinc-400 hover:text-rose-400" title="Remove">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {channelMembers.length === 0 && <p className="px-2 text-sm text-zinc-500">No members yet.</p>}
            </div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Add members</p>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {dmUsers.filter((u) => !channelMembers.some((m) => m.id === u.id)).map((u) => (
                <button key={u.id} onClick={() => void addMember(u.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <span className="truncate font-medium text-zinc-800 dark:text-zinc-100">{u.name}</span>
                  <Plus className="ml-auto h-3.5 w-3.5 shrink-0 text-indigo-400" />
                </button>
              ))}
              {dmUsers.filter((u) => !channelMembers.some((m) => m.id === u.id)).length === 0 && (
                <p className="px-2 text-sm text-zinc-500">Everyone is a member.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center bg-indigo-600/10 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-indigo-500 bg-white/95 px-10 py-8 text-center shadow-2xl dark:bg-zinc-900/95">
            <Paperclip className="mx-auto h-10 w-10 text-indigo-500" />
            <p className="mt-2 text-lg font-bold text-zinc-900 dark:text-white">Drop files to attach</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Images, PDFs, videos, documents — anything</p>
          </div>
        </div>
      )}
    </div>
  );
}