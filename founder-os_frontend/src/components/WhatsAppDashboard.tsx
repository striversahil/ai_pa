"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useLiveEvent } from "@/hooks/useLiveData";

interface Digest {
  id: string;
  chatId: string;
  chatName: string;
  summary: string;
  priority: "low" | "medium" | "high" | "urgent";
  category: string;
  sentiment: string;
  requiresFounder: boolean;
  suggestedReply?: string;
  createdAt: string;
}

interface Contact {
  uid: string;
  name: string;
  phone_number: string;
  email?: string;
  isGroup?: boolean;
  picture?: string | null;
}

interface RawMessage {
  id: string;
  chatId: string;
  sender: string;
  body: string;
  timestamp: string;
  processed: boolean;
  quotedMessageId?: string | null;
  quotedBody?: string | null;
  quotedSender?: string | null;
  mediaUrl?: string | null;
}

interface PendingItem {
  id: string;
  chatId: string;
  chatName: string;
  description: string;
  status: string;
  dueDate: string | null;
  sourceMessageId: string | null;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface PendingChat {
  chatId: string;
  chatName: string;
  openCount: number;
  items: PendingItem[];
}

export default function WhatsAppDashboard() {
  const [inboxCategory, setInboxCategory] = useState<"all" | "urgent" | "leads" | "support">("all");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [digests, setDigests] = useState<Digest[]>([]);
  const [selectedContactUid, setSelectedContactUid] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<RawMessage[]>([]);

  const [replyText, setReplyText] = useState("");
  const [isSending, setIsSending] = useState(false);

  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);

  const [pendingChats, setPendingChats] = useState<PendingChat[]>([]);
  const [isLoadingPending, setIsLoadingPending] = useState(false);
  const [showOwePanel, setShowOwePanel] = useState(true);

  const [noteText, setNoteText] = useState("");
  const [noteStatus, setNoteStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const [pictureInputOpen, setPictureInputOpen] = useState(false);
  const [pictureUrl, setPictureUrl] = useState("");

  const updatePicture = async (contactUid: string, picture: string | null) => {
    try {
      const res = await fetch(`/api/whatsapp/contacts/${encodeURIComponent(contactUid)}/picture`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ picture }),
      });
      if (res.ok) {
        setContacts((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          return list.map((c) => (c.uid === contactUid ? { ...c, picture: picture || null } : c));
        });
        setPictureInputOpen(false);
        setPictureUrl("");
      }
    } catch (err) {
      console.error("Failed to update picture:", err);
    }
  };

  const [uploadingPicture, setUploadingPicture] = useState(false);
  const pictureInputRef = useRef<HTMLInputElement | null>(null);

  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  // Per-chat message cache so switching between recent chats is instant (no
  // round trip on every click). Keyed by contact uid; `hasMore` per chat tells
  // the scroll-up handler whether older history exists.
  const messagesCache = useRef<Map<string, RawMessage[]>>(new Map());
  const hasMoreCache = useRef<Map<string, boolean>>(new Map());
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const contactList = useMemo<Contact[]>(() => {
    if (Array.isArray(contacts)) return contacts;
    if (contacts && Array.isArray((contacts as any).contacts)) return (contacts as any).contacts;
    if (contacts && Array.isArray((contacts as any).data)) return (contacts as any).data;
    return [];
  }, [contacts]);

  const digestList = useMemo<Digest[]>(() => {
    if (Array.isArray(digests)) return digests;
    if (digests && Array.isArray((digests as any).digests)) return (digests as any).digests;
    if (digests && Array.isArray((digests as any).data)) return (digests as any).data;
    return [];
  }, [digests]);

  const messageList = useMemo<RawMessage[]>(() => {
    let list: RawMessage[] = [];
    if (Array.isArray(chatMessages)) list = chatMessages;
    else if (chatMessages && Array.isArray((chatMessages as any).messages)) list = (chatMessages as any).messages;
    else if (chatMessages && Array.isArray((chatMessages as any).data)) list = (chatMessages as any).data;
    return [...list].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [chatMessages]);

  const fetchContacts = async () => {
    setIsLoadingContacts(true);
    try {
      const res = await fetch("/api/whatsapp/contacts");
      if (res.ok) {
        const data = await res.json();
        setContacts(data);
        const contactListFetched = Array.isArray(data)
          ? data
          : data.contacts && Array.isArray(data.contacts)
            ? data.contacts
            : [];
        if (contactListFetched.length > 0 && !selectedContactUid) {
          setSelectedContactUid(contactListFetched[0].uid);
        }
      }
    } catch (err) {
      console.error("Failed to fetch contacts:", err);
    } finally {
      setIsLoadingContacts(false);
    }
  };

  const fetchDigests = async () => {
    try {
      const res = await fetch("/api/digests");
      if (res.ok) {
        const data = await res.json();
        setDigests(data);
      }
    } catch (err) {
      console.error("Failed to fetch digests:", err);
    }
  };

  const fetchMessages = async (contactUid: string, isSilent = false) => {
    if (!isSilent) {
      setIsLoadingMessages(true);
    }
    try {
      const cached = messagesCache.current.get(contactUid);
      if (cached && cached.length > 0) {
        // Instant render from cache; refresh silently in background so the
        // latest messages (new inbound, sent replies) are reconciled.
        setChatMessages(cached);
        setIsLoadingMessages(false);
        if (!isSilent) {
          void fetchMessages(contactUid, true).then(() => setIsLoadingMessages(false));
          setIsLoadingMessages(false);
        }
        return;
      }
      const res = await fetch(`/api/whatsapp/contacts/${encodeURIComponent(contactUid)}/messages?limit=50`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : [];
        const sorted = [...list].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        messagesCache.current.set(contactUid, sorted);
        hasMoreCache.current.set(contactUid, list.length >= 50);
        setHasMore(list.length >= 50);
        setChatMessages(sorted);
      }
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    } finally {
      if (!isSilent) {
        setIsLoadingMessages(false);
      }
    }
  };

  // Load one older page (50) and prepend it — called when the user scrolls to
  // the top of the thread.
  const loadOlderMessages = async (contactUid: string) => {
    if (loadingOlder || !contactUid) return;
    const cached = messagesCache.current.get(contactUid) || [];
    if (cached.length === 0) return;
    if (!hasMoreCache.current.get(contactUid)) return;
    setLoadingOlder(true);
    try {
      const oldest = [...cached].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0];
      const before = encodeURIComponent(oldest.timestamp);
      const res = await fetch(`/api/whatsapp/contacts/${encodeURIComponent(contactUid)}/messages?limit=50&before=${before}`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : [];
        if (list.length === 0) {
          hasMoreCache.current.set(contactUid, false);
          setHasMore(false);
          return;
        }
        const merged = [...list, ...cached];
        const byId = new Map<string, RawMessage>();
        for (const m of merged) byId.set(m.id || `${m.chatId}-${m.timestamp}`, m);
        const sorted = [...byId.values()].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        messagesCache.current.set(contactUid, sorted);
        hasMoreCache.current.set(contactUid, list.length >= 50);
        setHasMore(list.length >= 50);
        setChatMessages(sorted);
      }
    } catch (err) {
      console.error("Failed to load older messages:", err);
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleChatScroll = () => {
    const el = chatContainerRef.current;
    if (!el) return;
    if (el.scrollTop <= 24 && selectedContactUid) {
      void loadOlderMessages(selectedContactUid);
    }
  };

  const generateContactSummary = async (contactUid: string) => {
    setIsSummarizing(true);
    try {
      const res = await fetch(`/api/whatsapp/contacts/${contactUid}/summarize`, { method: "POST" });
      if (res.ok) {
        const newDigest = await res.json();
        setDigests(prev => {
          const list = Array.isArray(prev) ? prev : [];
          const filtered = list.filter(d => d.id !== newDigest.id && d.chatId !== newDigest.chatId);
          return [newDigest, ...filtered];
        });
      }
    } catch (err) {
      console.error("Failed to generate summary:", err);
    } finally {
      setIsSummarizing(false);
    }
  };

  const fetchPendingItems = async () => {
    setIsLoadingPending(true);
    try {
      const res = await fetch("/api/pending-items");
      if (res.ok) {
        const data = await res.json();
        const chats = Array.isArray(data) ? data : data.chats && Array.isArray(data.chats) ? data.chats : [];
        setPendingChats(chats);
      }
    } catch (err) {
      console.error("Failed to fetch pending items:", err);
    } finally {
      setIsLoadingPending(false);
    }
  };

  const resolvePendingItem = async (id: string) => {
    try {
      const res = await fetch(`/api/pending-items/${id}/resolve`, { method: "POST" });
      if (res.ok) {
        fetchPendingItems();
      }
    } catch (err) {
      console.error("Failed to resolve pending item:", err);
    }
  };

  const fetchNote = async (contactUid: string) => {
    try {
      const res = await fetch(`/api/whatsapp/contacts/${encodeURIComponent(contactUid)}/note`);
      if (res.ok) {
        const data = await res.json();
        setNoteText(data.content || "");
        setNoteStatus("idle");
      }
    } catch (err) {
      console.error("Failed to fetch note:", err);
    }
  };

  const saveNote = async () => {
    if (!selectedContactUid) return;
    setNoteStatus("saving");
    try {
      const res = await fetch(`/api/whatsapp/contacts/${encodeURIComponent(selectedContactUid)}/note`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteText }),
      });
      setNoteStatus(res.ok ? "saved" : "error");
    } catch (err) {
      console.error("Failed to save note:", err);
      setNoteStatus("error");
    }
    setTimeout(() => setNoteStatus((s) => (s === "saved" ? "idle" : s)), 2000);
  };

  useEffect(() => {
    fetchContacts();
    fetchDigests();
    fetchPendingItems();
  }, []);

  // Live refresh of aggregate numbers (contacts / digests / pending items) whenever
  // the backend broadcasts a change from any write path — not just inbound messages.
  useLiveEvent((e) => {
    if (["messages", "contacts", "digests", "pending-items"].includes(e.type)) {
      fetchContacts();
      fetchDigests();
      fetchPendingItems();
    }
  });

  useEffect(() => {
    if (selectedContactUid) {
      fetchMessages(selectedContactUid);
      fetchNote(selectedContactUid);
      const exists = digestList.some(d => d.id === selectedContactUid || d.chatId === selectedContactUid);
      if (!exists) {
        generateContactSummary(selectedContactUid);
      }
    }
  }, [selectedContactUid, digestList]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContactUid, isLoadingMessages, messageList.length]);

  useEffect(() => {
    const eventSource = new EventSource("/api/whatsapp/events");

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === "message.received") {
          const msg = payload.data;
          const isActive = selectedContactUid && (
            msg.chatId === selectedContactUid ||
            msg.chatId.replace(/[^0-9]/g, '') === selectedContactUid.replace(/[^0-9]/g, '')
          );
          if (isActive) {
            const newMsg: RawMessage = {
              id: msg.id || String(Math.random()),
              chatId: selectedContactUid,
              sender: msg.sender === 'Founder' || msg.sender === 'You' ? 'You' : 'Client',
              body: msg.body,
              timestamp: msg.timestamp,
              processed: false,
              quotedMessageId: msg.quotedMessageId || null,
              quotedBody: msg.quotedBody || null,
              quotedSender: msg.quotedSender || null,
              mediaUrl: msg.mediaUrl || null,
            };
            const cur = messagesCache.current.get(selectedContactUid) || [];
            messagesCache.current.set(selectedContactUid, [...cur, newMsg]);
            setChatMessages((prev) => {
              const list = Array.isArray(prev) ? prev : [];
              if (list.some((m) => m.body === msg.body && m.timestamp === msg.timestamp)) {
                return list;
              }
              return [...list, newMsg];
            });
          }
          fetchDigests();
          fetchContacts();
          fetchPendingItems();
        } else if (payload.event === "message.classified") {
          fetchDigests();
          fetchContacts();
          fetchPendingItems();
          if (selectedContactUid && payload.data.chatId === selectedContactUid) {
            fetchMessages(selectedContactUid, true);
          }
        }
      } catch (err) {
        console.error("Failed to parse SSE real-time update:", err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [selectedContactUid]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedContactUid || isSending) return;

    setIsSending(true);
    const bodyText = replyText;
    setReplyText("");

    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: selectedContactUid,
          message_body: bodyText,
        }),
      });

      if (res.ok) {
        // Optimistic append to the active thread + cache so the sent message
        // shows instantly; a silent refresh reconciles the server copy.
        const sent: RawMessage = {
          id: `local-${Date.now()}`,
          chatId: selectedContactUid,
          sender: "You",
          body: bodyText,
          timestamp: new Date().toISOString(),
          processed: true,
        };
        const cur = messagesCache.current.get(selectedContactUid) || [];
        messagesCache.current.set(selectedContactUid, [...cur, sent]);
        setChatMessages((prev) => [...(Array.isArray(prev) ? prev : []), sent]);
        void fetchMessages(selectedContactUid, true);
        fetchPendingItems();
      } else {
        alert("Failed to send message.");
      }
    } catch (err) {
      console.error("Send message error:", err);
    } finally {
      setIsSending(false);
    }
  };

  const activeDigest = useMemo(() => {
    return digestList.find((d) => d.id === selectedContactUid || d.chatId === selectedContactUid) || null;
  }, [digestList, selectedContactUid]);

  const activePendingItems = useMemo(() => {
    if (!selectedContactUid) return [];
    const chat = pendingChats.find((c) => c.chatId === selectedContactUid);
    return chat ? chat.items : [];
  }, [pendingChats, selectedContactUid]);

  const oweChats = useMemo(() => {
    const now = Date.now();
    return pendingChats.map((chat) => ({
      ...chat,
      items: [...chat.items].sort((a, b) => {
        const aOverdue = a.dueDate && new Date(a.dueDate).getTime() < now ? 0 : 1;
        const bOverdue = b.dueDate && new Date(b.dueDate).getTime() < now ? 0 : 1;
        if (aOverdue !== bOverdue) return aOverdue - bOverdue;
        const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return aDue - bDue;
      }),
    }));
  }, [pendingChats]);

  const pendingCountForChat = useMemo(() => {
    const map: Record<string, number> = {};
    for (const chat of pendingChats) {
      map[chat.chatId] = chat.openCount;
    }
    return map;
  }, [pendingChats]);

  const filteredContacts = useMemo(() => {
    const list = contactList.filter((c) => {
      const digest = digestList.find((d) => d.id === c.uid || d.chatId === c.uid);
      if (inboxCategory === "all") return true;
      if (!digest) return false;
      if (inboxCategory === "urgent") return digest.requiresFounder || digest.priority === "urgent" || digest.priority === "high";
      if (inboxCategory === "leads") return String(digest.category).toLowerCase().includes("lead") || String(digest.category).toLowerCase().includes("enquiry");
      if (inboxCategory === "support") return String(digest.category).toLowerCase().includes("support") || String(digest.category).toLowerCase().includes("general");
      return true;
    });

    return [...list].sort((a, b) => {
      const digestA = digestList.find((d) => d.id === a.uid || d.chatId === a.uid);
      const digestB = digestList.find((d) => d.id === b.uid || d.chatId === b.uid);
      if (digestA && digestB) {
        return new Date(digestB.createdAt).getTime() - new Date(digestA.createdAt).getTime();
      }
      if (digestA) return -1;
      if (digestB) return 1;
      return 0;
    });
  }, [contactList, digestList, inboxCategory]);

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div>
          <h1 className="text-3xl font-bold font-heading text-zinc-900 dark:text-white flex items-center gap-2">
            <span>💬</span> WhatsApp Inbox
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">AI-powered chat summaries and real-time messaging</p>
        </div>
      </div>

      {/* Global "What I Owe" panel: every chat with open pending-from-founder items */}
      {pendingChats.length > 0 && (
        <div className="bg-zinc-50/30 dark:bg-zinc-900/30 border border-zinc-200/80 dark:border-zinc-800/80 rounded-2xl p-4">
          <button
            onClick={() => setShowOwePanel(!showOwePanel)}
            className="w-full flex items-center justify-between cursor-pointer border-0 bg-transparent"
          >
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-zinc-900 dark:text-white text-sm flex items-center gap-2">
                <span>⏳</span> What I Owe
              </h2>
              <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                {pendingChats.reduce((n, c) => n + c.openCount, 0)} open
              </span>
            </div>
            <span className="text-zinc-600 dark:text-zinc-500 text-xs">{showOwePanel ? "▾ Collapse" : "▸ Expand"}</span>
          </button>

          {showOwePanel && (
            <div className="mt-3 space-y-3">
              {isLoadingPending ? (
                <div className="text-xs text-zinc-600 dark:text-zinc-500 animate-pulse">Loading pending items...</div>
              ) : (
                oweChats.map((chat) => (
                  <div key={chat.chatId} className="bg-zinc-50/40 dark:bg-zinc-950/40 border border-zinc-850 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => setSelectedContactUid(chat.chatId)}
                        className="text-xs font-bold text-indigo-300 hover:text-indigo-200 cursor-pointer border-0 bg-transparent p-0 text-left"
                      >
                        {chat.chatName}
                      </button>
                      <span className="text-[9px] font-extrabold text-zinc-600 dark:text-zinc-500 shrink-0">{chat.openCount} item{chat.openCount !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {chat.items.map((item) => {
                        const isOverdue = item.dueDate && new Date(item.dueDate).getTime() < Date.now();
                        return (
                          <div key={item.id} className={`flex items-start justify-between gap-2 rounded-lg px-2.5 py-2 border ${isOverdue ? "bg-rose-500/5 border-rose-500/30" : "bg-zinc-50/60 dark:bg-zinc-900/60 border-zinc-200 dark:border-zinc-800"}`}>
                            <div className="space-y-0.5 min-w-0">
                              <p className={`text-xs leading-relaxed ${isOverdue ? "text-rose-200" : "text-zinc-800 dark:text-zinc-200"}`}>{item.description}</p>
                              {item.dueDate && (
                                <span className={`text-[9px] font-bold uppercase ${isOverdue ? "text-rose-400" : "text-zinc-600 dark:text-zinc-500"}`}>
                                  {isOverdue ? "⚠️ Overdue" : "Due"}: {new Date(item.dueDate).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => resolvePendingItem(item.id)}
                              title="Mark as done"
                              className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 cursor-pointer shrink-0"
                            >
                              ✓ Done
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:h-[800px]">
        {/* Left panel: Contacts */}
        <div className="h-[45vh] lg:h-auto lg:col-span-4 bg-zinc-50/30 dark:bg-zinc-900/30 border border-zinc-200/80 dark:border-zinc-800/80 rounded-2xl flex flex-col overflow-hidden">
          <div className="flex border-b border-[var(--border-card)] dark:border-zinc-800 p-2 overflow-x-auto gap-1 select-none">
            {(["all", "urgent", "leads", "support"] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setInboxCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wider transition-all border-0 cursor-pointer ${inboxCategory === cat
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white border border-zinc-300 dark:border-zinc-700"
                  : "text-zinc-600 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 bg-transparent"
                  }`}
              >
                {cat === "all" ? "All" : cat === "urgent" ? "Urgent" : cat === "leads" ? "Leads" : "Support"}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[var(--border-card)] dark:divide-zinc-800 scrollbar-thin">
            {isLoadingContacts ? (
              <div className="p-8 text-center text-zinc-600 dark:text-zinc-500 animate-pulse text-xs">Loading contacts...</div>
            ) : filteredContacts.length === 0 ? (
              <div className="p-8 text-center text-zinc-600 dark:text-zinc-500 text-xs italic">No contacts found.</div>
            ) : (
              filteredContacts.map((c, index) => {
                const digest = digestList.find((d) => d.id === c.uid || d.chatId === c.uid);
                const isSelected = selectedContactUid === c.uid;
                return (
                  <div
                    key={c.uid || index}
                    onClick={() => setSelectedContactUid(c.uid)}
                    className={`p-4 cursor-pointer hover:bg-[var(--bg-input)] dark:hover:bg-zinc-800/50 transition-all space-y-2 border-l-4 ${isSelected ? "bg-[var(--bg-input)] dark:bg-zinc-800/60 border-l-indigo-500" : "border-l-transparent"
                      }`}
                  >
                    <div className="flex items-center gap-3">
                      {c.picture ? (
                        <img src={c.picture} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600/20 text-xs font-bold text-indigo-400">
                          {(c.name || c.phone_number || "?").charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100 block flex items-center gap-1.5 truncate">
                        {c.isGroup && <span title="Group" className="text-[11px]">👥</span>}
                        {c.name || c.phone_number}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {pendingCountForChat[c.uid] > 0 && (
                          <span
                            title={`${pendingCountForChat[c.uid]} pending from you`}
                            className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          >
                            {pendingCountForChat[c.uid]} ⏳
                          </span>
                        )}
                        <span className="text-[10px] text-zinc-600 dark:text-zinc-500">{c.isGroup ? 'Group' : c.phone_number}</span>
                      </div>
                    </div>
                    {digest ? (
                      <>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">{digest.summary}</p>
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded ${digest.priority === "urgent" || digest.priority === "high"
                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-700"
                            }`}>
                            {digest.priority}
                          </span>
                          <span className="bg-[var(--bg-input)] text-[var(--text-tertiary)] dark:bg-zinc-800 dark:text-zinc-400 text-[9px] font-semibold px-2 py-0.5 rounded border border-[var(--border-card)] dark:border-zinc-700">
                            {digest.category}
                          </span>
                          <span className="text-xs">{digest.sentiment === "positive" ? "😊" : digest.sentiment === "negative" ? "😠" : "😐"}</span>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-zinc-600 dark:text-zinc-500 italic">Click to generate AI summary...</p>
                    )}
                  </div>
                </div>
                </div>
                );
              })
            )}
          </div>
        </div>

        {/* Center panel: Chat */}
        <div className="h-[60vh] lg:h-auto lg:col-span-5 bg-zinc-50/30 dark:bg-zinc-900/30 border border-zinc-200/80 dark:border-zinc-800/80 rounded-2xl flex flex-col overflow-hidden">
          {selectedContactUid ? (
            <>
              <div className="p-4 border-b border-zinc-850 flex items-center justify-between bg-zinc-50/20 dark:bg-zinc-950/20">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative shrink-0">
                    {contactList.find(c => c.uid === selectedContactUid)?.picture ? (
                      <img
                        src={contactList.find(c => c.uid === selectedContactUid)!.picture!}
                        alt=""
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600/20 text-sm font-bold text-indigo-400">
                        {(contactList.find(c => c.uid === selectedContactUid)?.name || selectedContactUid || "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <button
                      onClick={() => setPictureInputOpen((v) => !v)}
                      title="Change chat picture"
                      className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-indigo-600 text-white text-[9px] leading-none border-2 border-zinc-900 dark:border-zinc-100 cursor-pointer flex items-center justify-center"
                    >
                      ✎
                    </button>
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-extrabold text-zinc-900 dark:text-white text-sm flex items-center gap-1.5 truncate">
                      {contactList.find(c => c.uid === selectedContactUid)?.isGroup && <span className="text-[14px]">👥</span>}
                      {contactList.find(c => c.uid === selectedContactUid)?.name || selectedContactUid}
                    </h3>
                    <p className="text-[10px] text-zinc-600 dark:text-zinc-500 mt-0.5">Contact: <span className="font-mono text-[9px]">{selectedContactUid}</span></p>
                  </div>
                </div>
                <button
                  onClick={() => generateContactSummary(selectedContactUid)}
                  disabled={isSummarizing}
                  className="px-2.5 py-1 text-[10px] bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 font-extrabold rounded border border-indigo-500/30 cursor-pointer"
                >
                  {isSummarizing ? "Auditing..." : "Re-Audit Summary"}
                </button>
              </div>

              {pictureInputOpen && (
                <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-4 py-2">
                  <input
                    type="text"
                    value={pictureUrl}
                    onChange={(e) => setPictureUrl(e.target.value)}
                    placeholder="Paste image URL…"
                    className="flex-1 text-xs bg-[var(--bg-input)] border border-[var(--border-card)] dark:border-zinc-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={() => selectedContactUid && void updatePicture(selectedContactUid, pictureUrl.trim() || null)}
                    className="text-[10px] bg-indigo-600 text-white font-bold px-3 py-1.5 rounded-lg cursor-pointer"
                  >
                    Set
                  </button>
                  {contactList.find(c => c.uid === selectedContactUid)?.picture && (
                    <button
                      onClick={() => selectedContactUid && void updatePicture(selectedContactUid, null)}
                      className="text-[10px] bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-bold px-3 py-1.5 rounded-lg cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </div>
              )}

              <div ref={chatContainerRef} onScroll={handleChatScroll} className="flex-1 p-4 overflow-y-auto space-y-4 bg-zinc-955/10 scrollbar-thin">
                {hasMore && (
                  <div className="text-center">
                    <button
                      onClick={() => selectedContactUid && void loadOlderMessages(selectedContactUid)}
                      disabled={loadingOlder}
                      className="text-[10px] bg-[var(--bg-input)] hover:bg-zinc-200 dark:hover:bg-zinc-800 text-[var(--text-tertiary)] dark:text-zinc-400 px-3 py-1 rounded-full border border-[var(--border-card)] dark:border-zinc-700 disabled:opacity-50"
                    >
                      {loadingOlder ? "Loading…" : "↑ Load older messages"}
                    </button>
                  </div>
                )}
                {isLoadingMessages ? (
                  <div className="h-full flex items-center justify-center text-zinc-600 dark:text-zinc-500 text-xs animate-pulse">Loading messages...</div>
                ) : messageList.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-zinc-600 dark:text-zinc-500 text-xs italic">No messages yet.</div>
                ) : (
                  messageList.map((msg, index) => {
                    const isMe = msg.sender === "You";
                    const selectedContact = contactList.find(c => c.uid === selectedContactUid);
                    const isGroup = selectedContact?.isGroup;
                    const senderLabel = isGroup && !isMe ? (msg.sender || "Unknown") : "";
                    return (
                      <div key={msg.id || index} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-xs shadow-sm leading-relaxed ${isMe
                          ? "bg-indigo-600 text-white rounded-br-none"
                          : "bg-zinc-100/90 dark:bg-zinc-800/90 text-zinc-900 dark:text-zinc-100 rounded-bl-none border border-zinc-300/50 dark:border-zinc-700/50"
                          }`}>
                          {senderLabel && (
                            <span className="text-[9px] font-extrabold text-indigo-400 block mb-1 uppercase tracking-wider">
                              {senderLabel}
                            </span>
                          )}
                          {msg.quotedBody && (
                            <div className={`mb-1.5 rounded-lg px-2.5 py-1.5 border-l-2 text-[10px] truncate ${isMe
                              ? "bg-indigo-500/30 border-indigo-300/60 text-indigo-100"
                              : "bg-zinc-50/60 dark:bg-zinc-900/60 border-zinc-500 text-zinc-500 dark:text-zinc-400"
                              }`}>
                              {msg.quotedSender && (
                                <span className="font-extrabold block mb-0.5 text-[9px] uppercase tracking-wider opacity-80">
                                  {msg.quotedSender.replace(/@.*$/, '')}
                                </span>
                              )}
                              <span className="italic">{msg.quotedBody}</span>
                            </div>
                          )}
                          {(() => {
                            const url = msg.mediaUrl;
                            const caption = msg.body.replace(/^\s*\[[^\]]*\]\s*/, "").trim();
                            const isImg = !!url && /\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(url);
                            if (isImg) {
                              return (
                                <>
                                  <a href={url!} target="_blank" rel="noreferrer" className="block">
                                    <img src={url!} alt="Media" loading="lazy" className="rounded-xl max-h-64 w-auto border border-black/10 dark:border-white/10 mb-1" />
                                  </a>
                                  {caption && <p className="whitespace-pre-wrap">{caption}</p>}
                                </>
                              );
                            }
                            if (url) {
                              const ext = (url.split("?")[0].split("#")[0].split(".").pop() || "file").toUpperCase();
                              return (
                                <>
                                  <a href={url!} target="_blank" rel="noreferrer"
                                    className={`inline-flex items-center gap-1.5 mb-1 rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold underline underline-offset-2 ${isMe ? "bg-indigo-500/25 text-white hover:bg-indigo-500/40" : "bg-zinc-900/5 dark:bg-white/10 text-zinc-800 dark:text-zinc-100 hover:bg-zinc-900/10 dark:hover:bg-white/20"}`}>
                                    Attachment · {ext}
                                  </a>
                                  {caption && <p className="whitespace-pre-wrap">{caption}</p>}
                                </>
                              );
                            }
                            return <p className="whitespace-pre-wrap">{msg.body}</p>;
                          })()}
                          <span className="text-[9px] text-zinc-500 dark:text-zinc-400 block mt-1.5 text-right font-mono">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <form onSubmit={handleSendMessage} className="p-4 border-t border-zinc-850 bg-zinc-50/20 dark:bg-zinc-950/20 flex gap-2">
                <textarea
                  rows={2}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Reply to client..."
                  className="flex-1 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-2 text-xs placeholder-zinc-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
                <button
                  type="submit"
                  disabled={isSending || !replyText.trim()}
                  className="text-white px-5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 font-bold rounded-xl text-xs transition-colors cursor-pointer border-0"
                >
                  {isSending ? "Sending..." : "Send"}
                </button>
              </form>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-600 dark:text-zinc-500 text-xs italic">Select a contact to open thread.</div>
          )}
        </div>

        {/* Right panel: AI Summary */}
        <div className="h-[45vh] lg:h-auto lg:col-span-3 bg-zinc-50/30 dark:bg-zinc-900/30 border border-zinc-200/80 dark:border-zinc-800/80 rounded-2xl p-5 flex flex-col space-y-5 overflow-y-auto scrollbar-thin">
          {selectedContactUid ? (
            <>
              <div>
                <h3 className="font-extrabold text-zinc-900 dark:text-white text-sm flex items-center gap-1.5 pb-2 border-b border-zinc-850">
                  <span>🧠</span> AI Conversation Audit
                </h3>
              </div>

              {/* Private per-chat note (Personal Context) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-600 dark:text-zinc-500 font-bold uppercase block">📝 My Note (private)</span>
                  <span className="text-[9px] text-zinc-500 dark:text-zinc-600 italic block">Only you can see this</span>
                </div>
                <textarea
                  rows={3}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onBlur={saveNote}
                  placeholder="Why you're following this conversation & what to watch for — e.g. 'Awaiting revised PO timeline; I owe Rahul the new pricing. Flag any mention of delivery delays.'"
                  className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-xs placeholder-zinc-600 focus:outline-none focus:border-indigo-500 resize-none"
                />
                <div className="flex items-center justify-between">
                  <span className={`text-[9px] font-bold ${noteStatus === "saved" ? "text-emerald-400" : noteStatus === "error" ? "text-rose-400" : noteStatus === "saving" ? "text-amber-400" : "text-transparent"}`}>
                    {noteStatus === "saved" ? "✓ Saved" : noteStatus === "saving" ? "Saving..." : noteStatus === "error" ? "Failed to save" : "·"}
                  </span>
                  <button
                    onClick={saveNote}
                    disabled={noteStatus === "saving"}
                    className="px-2.5 py-1 text-[9px] bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 font-extrabold rounded border border-indigo-500/30 cursor-pointer disabled:opacity-40"
                  >
                    Save
                  </button>
                </div>
              </div>

              {/* Per-chat "What I Owe" ledger */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-600 dark:text-zinc-500 font-bold uppercase block">⏳ What I Owe</span>
                  {activePendingItems.length > 0 && (
                    <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                      {activePendingItems.length} open
                    </span>
                  )}
                </div>
                {isLoadingPending ? (
                  <div className="text-xs text-zinc-600 dark:text-zinc-500 animate-pulse">Loading pending items...</div>
                ) : activePendingItems.length === 0 ? (
                  <div className="p-3 bg-zinc-50/40 dark:bg-zinc-950/40 border border-zinc-850 rounded-xl text-xs text-zinc-600 dark:text-zinc-500 italic">
                    Nothing pending from your side in this chat. ✅
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activePendingItems.map((item) => {
                      const isOverdue = item.dueDate && new Date(item.dueDate).getTime() < Date.now();
                      return (
                        <div key={item.id} className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs text-zinc-800 dark:text-zinc-200 leading-relaxed flex-1">{item.description}</p>
                            <button
                              onClick={() => resolvePendingItem(item.id)}
                              title="Mark as done"
                              className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 cursor-pointer shrink-0"
                            >
                              ✓ Done
                            </button>
                          </div>
                          {item.dueDate && (
                            <span className={`text-[9px] font-bold uppercase ${isOverdue ? "text-rose-400" : "text-zinc-600 dark:text-zinc-500"}`}>
                              {isOverdue ? "⚠️ Overdue" : "Due"}: {new Date(item.dueDate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {isSummarizing ? (
                <div className="py-20 text-center space-y-3">
                  <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-500 animate-pulse">Generating summary...</p>
                </div>
              ) : activeDigest ? (
                <>
                  <div className="bg-zinc-50/40 dark:bg-zinc-950/40 p-4 border border-zinc-855 rounded-xl space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-zinc-600 dark:text-zinc-500 font-bold uppercase">Sentiment</span>
                      <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded uppercase ${activeDigest.sentiment === "positive"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : activeDigest.sentiment === "negative"
                          ? "bg-rose-500/10 text-rose-400"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                        }`}>
                        {activeDigest.sentiment}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-zinc-600 dark:text-zinc-500 font-bold uppercase">Priority</span>
                      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase">{activeDigest.priority}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-zinc-600 dark:text-zinc-500 font-bold uppercase">Category</span>
                      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{activeDigest.category}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] text-zinc-600 dark:text-zinc-500 font-bold uppercase block">AI Summary</span>
                    <div className="p-4 bg-zinc-50/40 dark:bg-zinc-950/40 border border-zinc-850 rounded-xl text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                      {activeDigest.summary}
                    </div>
                  </div>

                  {activeDigest.suggestedReply && (
                    <div className="space-y-2">
                      <span className="text-[10px] text-zinc-600 dark:text-zinc-500 font-bold uppercase block">Suggested Reply</span>
                      <div className="p-4 bg-indigo-600/5 hover:bg-indigo-600/10 border border-indigo-500/20 rounded-xl text-xs text-indigo-200 leading-relaxed relative group">
                        <p className="italic">"{activeDigest.suggestedReply}"</p>
                        <button
                          onClick={() => setReplyText(activeDigest.suggestedReply || "")}
                          className="text-white mt-3 w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold rounded-lg transition-colors cursor-pointer border-0 uppercase tracking-wider"
                        >
                          Use AI Response
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-20 text-center text-zinc-550 text-xs italic">
                  No summary yet. Click "Re-Audit Summary" above.
                </div>
              )}
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-600 dark:text-zinc-500 text-xs italic text-center">Select a conversation to see AI audit.</div>
          )}
        </div>
      </div>
    </div>
  );
}