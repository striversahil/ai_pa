"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLiveQuery, useLiveEvent } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import {
  Hash, Plus, Send, MessagesSquare, Paperclip, FileText, X,
  Users, Search, ChevronDown, Smile, Settings,
} from "lucide-react";
import Lightbox from "@/components/Lightbox";
import MessageItem, { Avatar } from "./chat/MessageItem";
import EmojiPopover from "./chat/EmojiPopover";
import ContextMenu, { type ContextMenuItem } from "./chat/ContextMenu";
import ThemeSettingsPanel from "./chat/ThemeSettingsPanel";
import { chatStyle, fontPx, useChatSettings } from "./chat/theme";
import {
  Channel, ChatAttachment, ChatMessage, ChatReaction, ChatUser, LiveChatEvent,
  isPpt, mergeFromServer, upsert, userColor,
} from "./chat/types";

export default function ChatRoom() {
  const { me, canView } = useAuth();
  const isAdmin = me?.isAdmin ?? false;
  const isApproved = canView("chat");
  const { settings, update, reset } = useChatSettings();

  const channels = useLiveQuery<Channel[]>(
    async () => {
      const res = await fetch("/api/chat/channels");
      if (!res.ok) throw new Error("load channels failed");
      return res.json();
    },
    { events: (e) => e.type === "chat" && e.action === "channel-created" },
  );

  const [channelId, setChannelId] = useState<string | null>(null);
  const selectedId = channelId ?? (channels.data ?? [])[0]?.id ?? null;

  const msgsCache = useRef<Map<string, ChatMessage[]>>(new Map());
  const hasMoreCache = useRef<Map<string, boolean>>(new Map());
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [reactions, setReactions] = useState<Record<number, ChatReaction[]>>({});
  const [firstUnreadId, setFirstUnreadId] = useState<number | null>(null);

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

  const fetchReactions = async (id: string) => {
    try {
      const res = await fetch(`/api/chat/channels/${id}/reactions`);
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<number, ChatReaction[]> = {};
      for (const [k, v] of Object.entries(data as Record<string, ChatReaction[]>)) map[Number(k)] = v;
      setReactions(map);
    } catch { /* ignore */ }
  };

  const markChannelRead = (id: string) => {
    const all = msgsCache.current.get(id) || [];
    const maxId = all.reduce((m, x) => Math.max(m, x.id), 0);
    if (maxId <= 0) return;
    fetch(`/api/chat/channels/${id}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastReadId: maxId }),
    }).catch(() => {});
  };

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
    setReactions({});
    setReplyTo(null);
    setReactionPicker(null);
    setComposerPicker(null);
    setEditingId(null);
    const unread = (channels.data ?? []).find((c) => c.id === selectedId)?.unread ?? 0;
    setFirstUnreadId(unread > 0 && cached ? [...cached].sort((a, b) => a.id - b.id).slice(-unread)[0]?.id ?? null : null);
    fetchChannelMessages(selectedId, { silent: true })
      .then(() => {
        markChannelRead(selectedId);
        channels.refresh();
      })
      .catch(() => {})
      .finally(() => setMsgsLoading(false));
    fetchReactions(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useLiveEvent((e) => {
    const ev = e as LiveChatEvent;
    if (ev.type !== "chat" || !selectedId) return;
    if (ev.channelId === selectedId) {
      if (ev.action === "created" && ev.message) {
        setMsgs((prev) => upsert(prev, ev.message!));
        msgsCache.current.set(selectedId, upsert(msgsCache.current.get(selectedId) || [], ev.message!));
        expireTyping(selectedId, ev.message.senderId);
        markChannelRead(selectedId);
      } else if (ev.action === "updated" && ev.message) {
        setMsgs((prev) => upsert(prev, ev.message!));
        msgsCache.current.set(selectedId, upsert(msgsCache.current.get(selectedId) || [], ev.message!));
      } else if (ev.action === "deleted" && ev.id != null) {
        const mark = (m: ChatMessage) => (m.id === ev.id ? { ...m, deletedAt: new Date().toISOString() } : m);
        setMsgs((prev) => prev.map(mark));
        msgsCache.current.set(selectedId, (msgsCache.current.get(selectedId) || []).map(mark));
      } else if (ev.action === "reactions" && ev.messageId != null && Array.isArray(ev.reactions)) {
        const mid = ev.messageId;
        const list = ev.reactions;
        setReactions((prev) => ({ ...prev, [mid]: list }));
      } else if (ev.action === "typing" && ev.userId && ev.userId !== me?.user.id && ev.userName) {
        const uid = ev.userId;
        setTypingUsers((prev) => {
          const map = { ...(prev[selectedId] || {}) };
          map[uid] = { name: ev.userName!, until: Date.now() + 3000 };
          return { ...prev, [selectedId]: map };
        });
        if (typingTimers.current[uid]) clearTimeout(typingTimers.current[uid]);
        typingTimers.current[uid] = setTimeout(() => expireTyping(selectedId, uid), 3200);
      }
    } else if (ev.action === "channel-created") {
      channels.refresh();
    }
    if (ev.action === "created" && ev.message && ev.channelId !== selectedId) {
      channels.refresh();
    }
  });

  const toggleReaction = async (messageId: number, emoji: string) => {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/chat/messages/${messageId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      const data = await res.json();
      if (!res.ok) return;
      setReactions((prev) => ({ ...prev, [messageId]: data.reactions ?? [] }));
    } catch { /* ignore */ }
  };

  const [composer, setComposer] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [composerPicker, setComposerPicker] = useState<DOMRect | null>(null);
  const [reactionPicker, setReactionPicker] = useState<{ messageId: number; rect: DOMRect } | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [messageMenu, setMessageMenu] = useState<{ x: number; y: number; message: ChatMessage } | null>(null);
  const [channelMenu, setChannelMenu] = useState<{ x: number; y: number; channel: Channel } | null>(null);

  // Linked accounts share one chat identity: both ids count as "self".
  const [selfIds, setSelfIds] = useState<string[]>([]);
  useEffect(() => {
    if (!me?.user.id) return;
    const base = [me.user.id];
    setSelfIds(base);
    const pair = ["connect.bui2@gmail.com", "crypticlooks@gmail.com"];
    if (!pair.includes(me.user.email || "")) return;
    fetch("/api/chat/users")
      .then((r) => (r.ok ? r.json() : []))
      .then((users: ChatUser[]) => {
        const ids = users.filter((u) => pair.includes(u.email || "")).map((u) => u.id);
        if (ids.length) setSelfIds([...new Set([me.user.id, ...ids])]);
      })
      .catch(() => {});
  }, [me?.user.id, me?.user.email]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [atBottom, setAtBottomState] = useState(true);

  const [typingUsers, setTypingUsers] = useState<Record<string, Record<string, { name: string; until: number }>>>({});
  const lastTypingSent = useRef<Record<string, number>>({});
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const notifyTyping = () => {
    if (!selectedId) return;
    const now = Date.now();
    if (now - (lastTypingSent.current[selectedId] || 0) < 2000) return;
    lastTypingSent.current[selectedId] = now;
    fetch("/api/chat/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId: selectedId }),
    }).catch(() => {});
  };

  const expireTyping = (id: string, userId: string) => {
    setTypingUsers((prev) => {
      const map = { ...(prev[id] || {}) };
      delete map[userId];
      return { ...prev, [id]: map };
    });
  };

  const [loadingOlder, setLoadingOlder] = useState(false);
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
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [memberPanel, setMemberPanel] = useState<ChatUser[]>([]);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [viewer, setViewer] = useState<{ url: string; type: string; name: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); dragCounter.current += 1; setDragging(true); };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
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

  const openFile = (a: ChatAttachment) => setViewer({ url: `/api/chat/files/${a.key}`, type: a.type, name: a.name });

  const atBottomRef = useRef(true);
  const setAtBottom = useCallback((v: boolean) => {
    atBottomRef.current = v;
    setAtBottomState(v);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
    setAtBottom(true);
  }, []);

  const updateAtBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  }, []);

  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
      updateAtBottom();
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [updateAtBottom]);

  const jumpToPresent = () => {
    setFirstUnreadId(null);
    scrollToBottom("smooth");
  };

  const markChannelReadForce = async (id: string) => {
    try {
      await fetch(`/api/chat/channels/${id}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastReadId: 999999999 }),
      });
    } catch { /* ignore */ }
    channels.refresh();
  };

  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  };

  const messageMenuItems = (m: ChatMessage): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      { label: "Add Reaction", onSelect: () => setReactionPicker({ messageId: m.id, rect: new DOMRect(messageMenu!.x, messageMenu!.y, 0, 0) }) },
      { label: "Reply", onSelect: () => { setReplyTo(m); composerRef.current?.focus(); } },
      { label: "Copy Text", disabled: !m.body, onSelect: () => void copyText(m.body) },
    ];
    if (canModify(m) && !m.deletedAt) {
      items.push(
        { label: "Edit Message", onSelect: () => startEdit(m) },
        { label: "Delete Message", divider: true, danger: true, onSelect: () => void del(m) },
      );
    }
    return items;
  };

  const channelMenuItems = (c: Channel): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      { label: "Mark As Read", disabled: !c.unread, onSelect: () => void markChannelReadForce(c.id) },
      { label: "Copy Name", onSelect: () => void copyText(c.type === "dm" ? c.otherUser?.name || c.name : c.name) },
    ];
    if (isAdmin && c.type !== "dm") {
      items.push({ label: "Edit Channel", divider: true, onSelect: () => void openManageMembers(c) });
    }
    return items;
  };

  const jumpToMessage = async (id: number) => {
    setAtBottom(false);
    const exists = () => !!document.querySelector(`[data-mid="${id}"]`);
    if (!exists() && selectedId) {
      for (let i = 0; i < 8; i++) {
        const cached = msgsCache.current.get(selectedId) || [];
        const oldest = [...cached].sort((a, b) => a.id - b.id)[0];
        if (!oldest || oldest.id <= id) break;
        try {
          const res = await fetch(`/api/chat/channels/${selectedId}/messages?before=${oldest.id}&limit=50`);
          if (!res.ok) break;
          const older = await res.json();
          if (!Array.isArray(older) || older.length === 0) break;
          const merged = mergeFromServer(msgsCache.current.get(selectedId) || [], older, selectedId);
          msgsCache.current.set(selectedId, merged);
          hasMoreCache.current.set(selectedId, older.length >= 50);
          setMsgs(merged);
          setHasMore(older.length >= 50);
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          if (exists() || older.length < 50) break;
        } catch { break; }
      }
    }
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const el = document.querySelector(`[data-mid="${id}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashId(id);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashId(null), 1800);
    }
  };

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
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [channels.data]);

  const dms = (channels.data ?? []).filter((c) => c.type === "dm");
  const q = sidebarQuery.trim().toLowerCase();
  const filteredDms = q ? dms.filter((c) => (c.otherUser?.name || c.name).toLowerCase().includes(q)) : dms;
  const filteredGroups = q
    ? grouped.map(([cat, list]) => [cat, list.filter((c) => c.name.toLowerCase().includes(q))] as [string, Channel[]]).filter(([, list]) => list.length > 0)
    : grouped;

  useEffect(() => {
    if (freshChannel.current && (channels.data ?? []).some((c) => c.id === freshChannel.current!.id)) {
      freshChannel.current = null;
    }
  }, [channels.data]);

  useEffect(() => {
    if (!selectedId || !settings.showMembers) { setMemberPanel([]); return; }
    if (active?.type === "dm") {
      setMemberPanel(active.otherUser ? [active.otherUser as ChatUser] : []);
      return;
    }
    fetch(`/api/chat/channels/${selectedId}/members`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setMemberPanel(Array.isArray(list) ? list : []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, settings.showMembers, active?.type, active?.otherUser?.id]);

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
    setAtBottom(true);
    if (composerRef.current) composerRef.current.style.height = "auto";
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

  const canModify = (m: ChatMessage) => isAdmin || selfIds.includes(m.senderId);

  const startEdit = (m: ChatMessage) => {
    setEditingId(m.id);
    setEditText(m.body);
    setReactionPicker(null);
  };

  const saveEdit = async () => {
    if (editingId == null) return;
    const body = editText.trim();
    if (!body) return;
    try {
      const res = await fetch(`/api/chat/messages/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.error || "edit failed");
      setMsgs((prev) => upsert(prev, updated));
      msgsCache.current.set(selectedId, upsert(msgsCache.current.get(selectedId) || [], updated));
    } catch { /* ignore */ }
    setEditingId(null);
    setEditText("");
  };

  const cancelEdit = () => { setEditingId(null); setEditText(""); };

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

  const typers = Object.values(typingUsers[selectedId || ""] || {}).filter((t) => t.until > Date.now());
  const typerLabel = typers.length === 0
    ? null
    : typers.length === 1
      ? `${typers[0].name} is typing`
      : `${typers.slice(0, 2).map((t) => t.name).join(", ")}${typers.length > 2 ? ` +${typers.length - 2}` : ""} are typing`;

  const railItem = (c: Channel) => {
    const dm = c.type === "dm";
    const label = dm ? c.otherUser?.name || "Direct Message" : c.name;
    return (
      <button
        key={c.id}
        onClick={() => { setChannelId(c.id); setMsgs([]); setRailOpen(false); }}
        onContextMenu={(e) => { e.preventDefault(); setChannelMenu({ x: e.clientX, y: e.clientY, channel: c }); }}
        className={`group/item mb-0.5 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-[7px] text-left text-[15px] font-medium transition ${
          selectedId === c.id
            ? "bg-[var(--chat-active)] text-[var(--chat-text)]"
            : "text-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)]"
        }`}
      >
        {dm ? (
          <Avatar src={c.otherUser?.picture ?? null} name={c.otherUser?.name || c.name || "?"} size="h-8 w-8" color={userColor(c.otherUser?.id || c.id)} />
        ) : (
          <Hash className="h-5 w-5 shrink-0 text-[var(--chat-muted)]" />
        )}
        {dm ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate">{label}</span>
            {c.otherUser?.email && (
              <span className="block truncate text-[10px] text-[var(--chat-muted)]">{c.otherUser.email}</span>
            )}
          </span>
        ) : (
          <span className="truncate">{label}</span>
        )}
        {!!c.unread && (
          <span className="ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ backgroundColor: settings.accent }}>
            {c.unread > 99 ? "99+" : c.unread}
          </span>
        )}
        {isAdmin && !dm && (
          <button
            onClick={(e) => { e.stopPropagation(); void openManageMembers(c); }}
            className={`shrink-0 rounded p-0.5 hover:text-[var(--chat-text)] ${c.unread ? "" : "opacity-0 group-hover/item:opacity-100"}`}
            title="Manage members"
          >
            <Users className="h-4 w-4" />
          </button>
        )}
      </button>
    );
  };

  return (
    <div
      className="relative flex h-[calc(100vh-8rem)] min-h-[480px] overflow-hidden rounded-xl border border-[var(--chat-border)] font-sans"
      style={chatStyle(settings)}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <aside
        className={`${railOpen ? "flex" : "hidden"} absolute inset-y-0 left-0 z-20 w-64 flex-col border-r border-[var(--chat-border)] bg-[var(--chat-side)] shadow-xl md:static md:z-auto md:flex md:w-60 md:shadow-none`}
      >
        <div className="px-3 pt-3 pb-2">
          <button
            onClick={() => void openDmPicker()}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-bold text-white shadow-md transition hover:opacity-90"
            style={{ backgroundColor: settings.accent, boxShadow: `0 4px 14px rgba(var(--chat-accent-rgb), 0.4)` }}
          >
            <Plus className="h-4 w-4" /> New chat
          </button>
        </div>
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 rounded-md bg-[var(--chat-input)] px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-[var(--chat-muted)]" />
            <input
              value={sidebarQuery}
              onChange={(e) => setSidebarQuery(e.target.value)}
              placeholder="Search conversations"
              className="w-full bg-transparent text-xs text-[var(--chat-text)] outline-none placeholder:text-[var(--chat-muted)]"
            />
            {sidebarQuery && (
              <button onClick={() => setSidebarQuery("")} className="text-[var(--chat-muted)] hover:text-[var(--chat-text)]">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="px-3 pb-2">
            <button
              onClick={() => setShowNewChannel((v) => !v)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-[var(--chat-muted)] hover:text-[var(--chat-text)]"
            >
              Create channel
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showNewChannel ? "rotate-180" : ""}`} />
            </button>
            {showNewChannel && (
              <div className="mb-2 space-y-2 rounded-lg border border-[var(--chat-border)] bg-[var(--chat-float)] p-3">
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Channel name" autoFocus
                  className="w-full rounded-md border border-[var(--chat-border)] bg-[var(--chat-input)] px-2 py-1.5 text-sm text-[var(--chat-text)] outline-none" />
                <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Category (e.g. Operations)"
                  className="w-full rounded-md border border-[var(--chat-border)] bg-[var(--chat-input)] px-2 py-1.5 text-sm text-[var(--chat-text)] outline-none" />
                <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Description (optional)"
                  className="w-full rounded-md border border-[var(--chat-border)] bg-[var(--chat-input)] px-2 py-1.5 text-sm text-[var(--chat-text)] outline-none" />
                <div className="rounded-md border border-[var(--chat-border)] bg-[var(--chat-input)] p-2">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--chat-muted)]">Add members</div>
                  <div className="max-h-24 space-y-1 overflow-y-auto">
                    {dmUsers.length === 0 ? (
                      <p className="text-xs text-[var(--chat-muted)]">Loading members…</p>
                    ) : (
                      dmUsers.map((u) => (
                        <label key={u.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-xs text-[var(--chat-text)]">
                          <input type="checkbox" checked={newMemberIds.includes(u.id)}
                            onChange={() => setNewMemberIds((prev) => prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id])}
                            className="accent-[var(--chat-accent)]" />
                          <span className="truncate">{u.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
                <button onClick={createChannel} disabled={creating}
                  className="w-full rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: settings.accent }}>
                  Create
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 pb-4 scrollbar-thin">
          {filteredDms.length > 0 && (
            <div className="mb-3">
              <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--chat-muted)]">
                Direct Messages {q ? `(filtered)` : `— ${filteredDms.length}`}
              </div>
              {filteredDms.map(railItem)}
            </div>
          )}
          {filteredGroups.map(([cat, list]) => {
            const isCollapsed = collapsed[cat] ?? false;
            return (
              <div key={cat} className="mb-3">
                <button
                  onClick={() => setCollapsed((p) => ({ ...p, [cat]: !isCollapsed }))}
                  className="flex w-full items-center gap-1 px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--chat-muted)] hover:text-[var(--chat-text)]"
                >
                  <ChevronDown className={`h-3 w-3 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                  {cat}
                  <span className="ml-1 font-normal opacity-70">— {list.length}</span>
                </button>
                {!isCollapsed && list.map(railItem)}
              </div>
            );
          })}
          {(channels.data ?? []).length === 0 && (
            <p className="px-2 text-xs text-[var(--chat-muted)]">No channels yet. An admin can create one.</p>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-[var(--chat-border)] px-3 py-2.5">
          <Avatar src={me?.user.picture ?? null} name={me?.user.name ?? "?"} size="h-8 w-8" color={userColor(me?.user.id ?? "me")} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-[var(--chat-text)]">{me?.user.name}</p>
            <p className="truncate text-[10px] text-[var(--chat-muted)]">{isAdmin ? "Admin" : "Member"}</p>
          </div>
          <button onClick={() => setShowSettings(true)} title="Chat appearance"
            className="rounded p-1.5 text-[var(--chat-muted)] hover:bg-[var(--chat-active)] hover:text-[var(--chat-text)]">
            <Settings className="h-4 w-4" />
          </button>
          <button onClick={() => setRailOpen(false)} title="Close" className="rounded p-1.5 text-[var(--chat-muted)] hover:text-[var(--chat-text)] md:hidden">
            <X className="h-4 w-4" />
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-[var(--chat-bg)]">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--chat-border)] px-3 shadow-sm">
          <button onClick={() => setRailOpen(true)} title="Channel list"
            className="rounded p-1.5 text-[var(--chat-muted)] hover:text-[var(--chat-text)] md:hidden">
            <Hash className="h-5 w-5" />
          </button>
          {active?.type === "dm" ? (
            <Avatar src={active.otherUser?.picture ?? null} name={active.otherUser?.name || "?"} size="h-6 w-6" color={userColor(active.otherUser?.id || active.id)} />
          ) : (
            <Hash className="h-5 w-5 shrink-0 text-[var(--chat-muted)]" />
          )}
          <span className="truncate text-[15px] font-bold text-[var(--chat-text)]">
            {active ? (active.type === "dm" ? active.otherUser?.name || "Direct Message" : active.name) : "Select a channel"}
          </span>
          {active?.description && (
            <>
              <div className="hidden h-6 w-px bg-[var(--chat-border)] lg:block" />
              <span className="hidden truncate text-xs text-[var(--chat-muted)] lg:block">{active.description}</span>
            </>
          )}
          <div className="ml-auto flex items-center gap-1">
            {settings.showMembers && memberPanel.length > 0 && (
              <div className="mr-1 hidden items-center xl:flex">
                {memberPanel.slice(0, 4).map((u, i) => (
                  <div key={u.id} className={i > 0 ? "-ml-2" : ""}>
                    <Avatar src={u.picture} name={u.name} size="h-6 w-6" color={userColor(u.id)} />
                  </div>
                ))}
                {memberPanel.length > 4 && (
                  <span className="-ml-2 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--chat-input)] text-[10px] font-bold text-[var(--chat-muted)]">
                    +{memberPanel.length - 4}
                  </span>
                )}
              </div>
            )}
            <button
              onClick={() => update({ showMembers: !settings.showMembers })}
              title={settings.showMembers ? "Hide member list" : "Show member list"}
              className={`rounded p-1.5 transition hover:text-[var(--chat-text)] ${settings.showMembers ? "text-[var(--chat-text)]" : "text-[var(--chat-muted)]"}`}
            >
              <Users className="h-5 w-5" />
            </button>
            <button onClick={() => setShowSettings(true)} title="Chat appearance"
              className="rounded p-1.5 text-[var(--chat-muted)] transition hover:text-[var(--chat-text)]">
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1">
          <div ref={scrollerRef} onScroll={updateAtBottom} className="relative flex-1 overflow-y-auto py-4 scrollbar-thin">
            {msgsLoading && msgs.length === 0 && (
              <div className="flex h-full items-center justify-center text-sm text-[var(--chat-muted)]">
                <span className="animate-pulse">Loading messages…</span>
              </div>
            )}
            {!msgsLoading && hasMore && (
              <div className="mb-3 text-center">
                <button onClick={loadOlder} disabled={loadingOlder}
                  className="rounded-lg bg-[var(--chat-input)] px-3 py-1.5 text-xs font-semibold text-[var(--chat-muted)] hover:text-[var(--chat-text)] disabled:opacity-60">
                  {loadingOlder ? "Loading…" : "Load older messages"}
                </button>
              </div>
            )}
            {msgs.length === 0 && !msgsLoading && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--chat-muted)]">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--chat-input)]">
                  <MessagesSquare className="h-9 w-9" />
                </div>
                <p className="text-lg font-bold text-[var(--chat-text)]">
                  {active ? (active.type === "dm" ? `This is your DM with ${active.otherUser?.name}` : `Welcome to #${active.name}`) : "Pick a channel"}
                </p>
                <p className="text-sm">This is the beginning of the conversation.</p>
              </div>
            )}
            <div ref={contentRef} style={{ fontSize: fontPx(settings) }}>
              {msgs.map((m, i) => (
                <React.Fragment key={m.id}>
                  {firstUnreadId != null && m.id === firstUnreadId && (
                    <div className="relative my-2 flex items-center px-4">
                      <div className="h-px flex-1" style={{ backgroundColor: "#f23f43" }} />
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white" style={{ backgroundColor: "#f23f43" }}>
                        New
                      </span>
                      <div className="h-px flex-1" style={{ backgroundColor: "#f23f43" }} />
                    </div>
                  )}
                  <MessageItem
                    m={m}
                    prev={i > 0 ? msgs[i - 1] : null}
                    settings={settings}
                    selfIds={selfIds}
                    canModify={canModify(m)}
                    reactions={reactions[m.id] ?? []}
                    pickerOpen={reactionPicker?.messageId === m.id}
                    onPickerOpen={(rect) => setReactionPicker({ messageId: m.id, rect })}
                    editing={editingId === m.id}
                    onEditStart={() => startEdit(m)}
                    onEditCancel={cancelEdit}
                    editText={editText}
                    onEditChange={setEditText}
                    onEditSave={() => void saveEdit()}
                    onReply={() => { setReplyTo(m); composerRef.current?.focus(); }}
                    onDelete={() => void del(m)}
                    onReact={(emoji) => void toggleReaction(m.id, emoji)}
                    onJump={(id) => void jumpToMessage(id)}
                    onOpenImages={openImages}
                    onOpenFile={openFile}
                    highlight={flashId === m.id || replyTo?.id === m.id}
                    onContext={(x, y) => setMessageMenu({ x, y, message: m })}
                  />
                </React.Fragment>
              ))}
            </div>
          </div>

          {!atBottom && msgs.length > 0 && (
            <button
              onClick={jumpToPresent}
              className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--chat-border)] bg-[var(--chat-float)] px-3.5 py-1.5 text-xs font-bold text-[var(--chat-text)] shadow-xl transition hover:opacity-90"
            >
              <ChevronDown className="h-3.5 w-3.5" /> Jump to present
            </button>
          )}

          {settings.showMembers && memberPanel.length > 0 && (
            <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-l border-[var(--chat-border)] bg-[var(--chat-side)] px-2 py-3 scrollbar-thin xl:flex">
              <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--chat-muted)]">
                {active?.type === "dm" ? "In this DM" : "Members"} — {memberPanel.length}
              </p>
              {memberPanel.map((u) => (
                <div key={u.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--chat-hover)]">
                  <Avatar src={u.picture} name={u.name} size="h-8 w-8" color={userColor(u.id)} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-[var(--chat-text)]">{u.name}</p>
                    {isAdmin && <p className="text-[10px] text-[var(--chat-muted)]">member</p>}
                  </div>
                </div>
              ))}
            </aside>
          )}
        </div>

        <footer className="relative shrink-0 px-4 pb-4 pt-1">
          {typerLabel && (
            <div className="mb-1 flex items-center gap-2 px-1 text-xs text-[var(--chat-muted)]">
              <span className="flex gap-0.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ backgroundColor: settings.accent }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:120ms]" style={{ backgroundColor: settings.accent }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:240ms]" style={{ backgroundColor: settings.accent }} />
              </span>
              <span className="italic">{typerLabel}…</span>
            </div>
          )}
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`}
                  className="flex items-center gap-2 rounded-lg border border-[var(--chat-border)] bg-[var(--chat-float)] px-2.5 py-1.5 text-xs text-[var(--chat-text)]">
                  <FileText className="h-4 w-4 shrink-0 text-[var(--chat-muted)]" />
                  <span className="max-w-[160px] truncate">{f.name}</span>
                  <span className="text-[var(--chat-muted)]">{f.size > 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`}</span>
                  <button onClick={() => setFiles((p) => p.filter((_, x) => x !== i))} className="text-[var(--chat-muted)] hover:text-rose-400" title="Remove">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="overflow-hidden rounded-xl bg-[var(--chat-input)]">
            {replyTo && (
              <div className="flex items-center gap-2 border-b border-[var(--chat-border)] px-3 py-2">
                <span className="text-xs text-[var(--chat-muted)]">Replying to</span>
                <span className="shrink-0 text-xs font-bold" style={{ color: userColor(replyTo.senderId) }}>
                  {replyTo.senderName}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--chat-muted)]">{replyTo.body || "(attachment)"}</span>
                <button onClick={() => setReplyTo(null)} className="shrink-0 rounded p-0.5 text-[var(--chat-muted)] hover:text-[var(--chat-text)]" title="Cancel reply">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="flex items-end gap-2 px-3 py-2">
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
              className="mb-0.5 rounded-full p-1 text-[var(--chat-muted)] transition hover:text-[var(--chat-text)] disabled:opacity-50" title="Attach image or document">
              <Plus className="h-5 w-5" />
            </button>
            <textarea
              ref={composerRef}
              value={composer}
              rows={1}
              onChange={(e) => {
                setComposer(e.target.value);
                notifyTyping();
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
              }}
              placeholder={active ? (active.type === "dm" ? `Message @${active.otherUser?.name ?? ""}` : `Message #${active.name}`) : "Select a channel to chat"}
              disabled={!selectedId}
              className="max-h-[200px] flex-1 resize-none bg-transparent py-1 text-[var(--chat-text)] outline-none placeholder:text-[var(--chat-muted)] disabled:opacity-50"
              style={{ fontSize: fontPx(settings) }}
            />
            <div className="relative mb-0.5 flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setComposerPicker(e.currentTarget.getBoundingClientRect());
                }}
                disabled={!selectedId}
                className="rounded-full p-1 text-[var(--chat-muted)] transition hover:text-[var(--chat-text)] disabled:opacity-50" title="Emoji"
              >
                <Smile className="h-5 w-5" />
              </button>
              <button onClick={() => void send()} disabled={!selectedId || (!composer.trim() && files.length === 0) || sending}
                className="rounded-full p-1 transition hover:opacity-80 disabled:opacity-40"
                style={{ color: composer.trim() || files.length > 0 ? settings.accent : "var(--chat-muted)" }} title="Send">
                <Send className={`h-5 w-5 ${composer.trim() || files.length > 0 ? "fill-current" : ""}`} />
              </button>
            </div>
            </div>
          </div>
          <div className="h-0.5" />
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
            ) : isPpt({ key: viewer.url, name: viewer.name, size: 0, type: viewer.type }) ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-zinc-900 p-10 text-center">
                <FileText className="h-12 w-12 text-amber-500" />
                <p className="font-semibold text-white">{viewer.name}</p>
                <p className="max-w-sm text-sm text-white/60">
                  PowerPoint preview isn&apos;t available on this platform yet — download the file to view it.
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
          <div className="w-full max-w-sm rounded-2xl border border-[var(--chat-border)] bg-[var(--chat-panel)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--chat-text)]">New message</h3>
              <button onClick={() => setShowDmPicker(false)} className="text-[var(--chat-muted)] hover:text-[var(--chat-text)]" title="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {dmUsers.map((u) => (
                <button key={u.id} onClick={() => void startDm(u.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--chat-hover)]">
                  <Avatar src={u.picture} name={u.name} size="h-8 w-8" color={userColor(u.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-[var(--chat-text)]">{u.name}</span>
                    {u.email && <span className="block truncate text-[11px] text-[var(--chat-muted)]">{u.email}</span>}
                  </span>
                </button>
              ))}
              {dmUsers.length === 0 && (
                <p className="px-3 py-2 text-sm text-[var(--chat-muted)]">No other members yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {manageChannel && isAdmin && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={() => setManageChannel(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-[var(--chat-border)] bg-[var(--chat-panel)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--chat-text)]">Manage #{manageChannel.name}</h3>
              <button onClick={() => setManageChannel(null)} className="text-[var(--chat-muted)] hover:text-[var(--chat-text)]" title="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--chat-muted)]">Members ({channelMembers.length})</p>
            <div className="mb-3 max-h-48 space-y-1 overflow-y-auto">
              {channelMembers.map((u) => (
                <div key={u.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                  <Avatar src={u.picture} name={u.name} size="h-6 w-6" color={userColor(u.id)} />
                  <span className="truncate font-medium text-[var(--chat-text)]">{u.name}</span>
                  <button onClick={() => void removeMember(u.id)}
                    className="ml-auto shrink-0 rounded p-0.5 text-[var(--chat-muted)] hover:text-rose-400" title="Remove">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {channelMembers.length === 0 && <p className="px-2 text-sm text-[var(--chat-muted)]">No members yet.</p>}
            </div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--chat-muted)]">Add members</p>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {dmUsers.filter((u) => !channelMembers.some((m) => m.id === u.id)).map((u) => (
                <button key={u.id} onClick={() => void addMember(u.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--chat-hover)]">
                  <Avatar src={u.picture} name={u.name} size="h-6 w-6" color={userColor(u.id)} />
                  <span className="truncate font-medium text-[var(--chat-text)]">{u.name}</span>
                  <Plus className="ml-auto h-3.5 w-3.5 shrink-0" style={{ color: settings.accent }} />
                </button>
              ))}
              {dmUsers.filter((u) => !channelMembers.some((m) => m.id === u.id)).length === 0 && (
                <p className="px-2 text-sm text-[var(--chat-muted)]">Everyone is a member.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center bg-[rgba(var(--chat-accent-rgb),0.12)] backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed px-10 py-8 text-center shadow-2xl"
            style={{ borderColor: settings.accent, background: "var(--chat-panel)" }}>
            <Paperclip className="mx-auto h-10 w-10" style={{ color: settings.accent }} />
            <p className="mt-2 text-lg font-bold text-[var(--chat-text)]">Drop files to attach</p>
            <p className="text-sm text-[var(--chat-muted)]">Images, PDFs, videos, documents — anything</p>
          </div>
        </div>
      )}

      {composerPicker && (
        <EmojiPopover
          rect={composerPicker}
          dark={settings.theme !== "light"}
          accent={settings.accent}
          keepOpenOnPick
          onPick={(e) => { setComposer((p) => p + e); composerRef.current?.focus(); }}
          onClose={() => setComposerPicker(null)}
        />
      )}

      {reactionPicker && (
        <EmojiPopover
          rect={reactionPicker.rect}
          dark={settings.theme !== "light"}
          accent={settings.accent}
          onPick={(e) => { void toggleReaction(reactionPicker.messageId, e); setReactionPicker(null); }}
          onClose={() => setReactionPicker(null)}
        />
      )}

      {messageMenu && (
        <ContextMenu
          x={messageMenu.x}
          y={messageMenu.y}
          items={messageMenuItems(messageMenu.message)}
          onClose={() => setMessageMenu(null)}
        />
      )}

      {channelMenu && (
        <ContextMenu
          x={channelMenu.x}
          y={channelMenu.y}
          items={channelMenuItems(channelMenu.channel)}
          onClose={() => setChannelMenu(null)}
        />
      )}

      {showSettings && (
        <ThemeSettingsPanel settings={settings} update={update} reset={reset} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
