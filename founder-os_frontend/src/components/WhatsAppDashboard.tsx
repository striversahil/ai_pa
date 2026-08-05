"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";

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

  const chatContainerRef = useRef<HTMLDivElement | null>(null);

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
      const res = await fetch(`/api/whatsapp/contacts/${contactUid}/messages`);
      if (res.ok) {
        const data = await res.json();
        setChatMessages(data);
      }
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    } finally {
      if (!isSilent) {
        setIsLoadingMessages(false);
      }
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

  useEffect(() => {
    fetchContacts();
    fetchDigests();
    fetchPendingItems();
  }, []);

  useEffect(() => {
    if (selectedContactUid) {
      fetchMessages(selectedContactUid);
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
  }, [messageList, isLoadingMessages]);

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
            setChatMessages((prev) => {
              const list = Array.isArray(prev) ? prev : [];
              if (list.some((m) => m.body === msg.body && m.timestamp === msg.timestamp)) {
                return list;
              }
              return [
                ...list,
                {
                  id: msg.id || String(Math.random()),
                  chatId: selectedContactUid,
                  sender: msg.sender === 'Founder' || msg.sender === 'You' ? 'You' : 'Client',
                  body: msg.body,
                  timestamp: msg.timestamp,
                  processed: false,
                  quotedMessageId: msg.quotedMessageId || null,
                  quotedBody: msg.quotedBody || null,
                  quotedSender: msg.quotedSender || null,
                }
              ];
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
        await fetchMessages(selectedContactUid);
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
    <div className="space-y-6 text-zinc-100 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-800 pb-5">
        <div>
          <h1 className="text-3xl font-bold font-heading text-white flex items-center gap-2">
            <span>💬</span> WhatsApp Inbox
          </h1>
          <p className="text-sm text-zinc-400">AI-powered chat summaries and real-time messaging</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[800px]">
        {/* Left panel: Contacts */}
        <div className="lg:col-span-4 bg-zinc-900/30 border border-zinc-800/80 rounded-2xl flex flex-col overflow-hidden">
          <div className="flex border-b border-zinc-850 p-2 overflow-x-auto gap-1 select-none">
            {(["all", "urgent", "leads", "support"] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setInboxCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wider transition-all border-0 cursor-pointer ${inboxCategory === cat
                  ? "bg-zinc-800 text-white border border-zinc-700"
                  : "text-zinc-500 hover:text-zinc-300 bg-transparent"
                  }`}
              >
                {cat === "all" ? "All" : cat === "urgent" ? "Urgent" : cat === "leads" ? "Leads" : "Support"}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-zinc-850 scrollbar-thin">
            {isLoadingContacts ? (
              <div className="p-8 text-center text-zinc-500 animate-pulse text-xs">Loading contacts...</div>
            ) : filteredContacts.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 text-xs italic">No contacts found.</div>
            ) : (
              filteredContacts.map((c, index) => {
                const digest = digestList.find((d) => d.id === c.uid || d.chatId === c.uid);
                const isSelected = selectedContactUid === c.uid;
                return (
                  <div
                    key={c.uid || index}
                    onClick={() => setSelectedContactUid(c.uid)}
                    className={`p-4 cursor-pointer hover:bg-zinc-850/50 transition-all space-y-2 border-l-4 ${isSelected ? "bg-zinc-850/60 border-l-indigo-500" : "border-l-transparent"
                      }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-sm text-zinc-100 block flex items-center gap-1.5">
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
                        <span className="text-[10px] text-zinc-500">{c.isGroup ? 'Group' : c.phone_number}</span>
                      </div>
                    </div>
                    {digest ? (
                      <>
                        <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">{digest.summary}</p>
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded ${digest.priority === "urgent" || digest.priority === "high"
                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                            }`}>
                            {digest.priority}
                          </span>
                          <span className="bg-zinc-850 text-zinc-400 text-[9px] font-semibold px-2 py-0.5 rounded border border-zinc-850">
                            {digest.category}
                          </span>
                          <span className="text-xs">{digest.sentiment === "positive" ? "😊" : digest.sentiment === "negative" ? "😠" : "😐"}</span>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-zinc-500 italic">Click to generate AI summary...</p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Center panel: Chat */}
        <div className="lg:col-span-5 bg-zinc-900/30 border border-zinc-800/80 rounded-2xl flex flex-col overflow-hidden h-full">
          {selectedContactUid ? (
            <>
              <div className="p-4 border-b border-zinc-850 flex items-center justify-between bg-zinc-950/20">
                <div>
                  <h3 className="font-extrabold text-white text-sm flex items-center gap-1.5">
                    {contactList.find(c => c.uid === selectedContactUid)?.isGroup && <span className="text-[14px]">👥</span>}
                    {contactList.find(c => c.uid === selectedContactUid)?.name || selectedContactUid}
                  </h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Contact: <span className="font-mono text-[9px]">{selectedContactUid}</span></p>
                </div>
                <button
                  onClick={() => generateContactSummary(selectedContactUid)}
                  disabled={isSummarizing}
                  className="px-2.5 py-1 text-[10px] bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 font-extrabold rounded border border-indigo-500/30 cursor-pointer"
                >
                  {isSummarizing ? "Auditing..." : "Re-Audit Summary"}
                </button>
              </div>

              <div ref={chatContainerRef} className="flex-1 p-4 overflow-y-auto space-y-4 bg-zinc-955/10 scrollbar-thin">
                {isLoadingMessages ? (
                  <div className="h-full flex items-center justify-center text-zinc-500 text-xs animate-pulse">Loading messages...</div>
                ) : messageList.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-zinc-500 text-xs italic">No messages yet.</div>
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
                          : "bg-zinc-800/90 text-zinc-100 rounded-bl-none border border-zinc-700/50"
                          }`}>
                          {senderLabel && (
                            <span className="text-[9px] font-extrabold text-indigo-400 block mb-1 uppercase tracking-wider">
                              {senderLabel}
                            </span>
                          )}
                          {msg.quotedBody && (
                            <div className={`mb-1.5 rounded-lg px-2.5 py-1.5 border-l-2 text-[10px] truncate ${isMe
                              ? "bg-indigo-500/30 border-indigo-300/60 text-indigo-100"
                              : "bg-zinc-900/60 border-zinc-500 text-zinc-400"
                              }`}>
                              {msg.quotedSender && (
                                <span className="font-extrabold block mb-0.5 text-[9px] uppercase tracking-wider opacity-80">
                                  {msg.quotedSender.replace(/@.*$/, '')}
                                </span>
                              )}
                              <span className="italic">{msg.quotedBody}</span>
                            </div>
                          )}
                          <p className="whitespace-pre-wrap">{msg.body}</p>
                          <span className="text-[9px] text-zinc-400 block mt-1.5 text-right font-mono">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <form onSubmit={handleSendMessage} className="p-4 border-t border-zinc-850 bg-zinc-950/20 flex gap-2">
                <textarea
                  rows={2}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Reply to client..."
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
                <button
                  type="submit"
                  disabled={isSending || !replyText.trim()}
                  className="px-5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer border-0"
                >
                  {isSending ? "Sending..." : "Send"}
                </button>
              </form>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-500 text-xs italic">Select a contact to open thread.</div>
          )}
        </div>

        {/* Right panel: AI Summary */}
        <div className="lg:col-span-3 bg-zinc-900/30 border border-zinc-800/80 rounded-2xl p-5 flex flex-col space-y-5 overflow-y-auto scrollbar-thin">
          {selectedContactUid ? (
            <>
              <div>
                <h3 className="font-extrabold text-white text-sm flex items-center gap-1.5 pb-2 border-b border-zinc-850">
                  <span>🧠</span> AI Conversation Audit
                </h3>
              </div>

              {/* Per-chat "What I Owe" ledger */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase block">⏳ What I Owe</span>
                  {activePendingItems.length > 0 && (
                    <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                      {activePendingItems.length} open
                    </span>
                  )}
                </div>
                {isLoadingPending ? (
                  <div className="text-xs text-zinc-500 animate-pulse">Loading pending items...</div>
                ) : activePendingItems.length === 0 ? (
                  <div className="p-3 bg-zinc-950/40 border border-zinc-850 rounded-xl text-xs text-zinc-500 italic">
                    Nothing pending from your side in this chat. ✅
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activePendingItems.map((item) => {
                      const isOverdue = item.dueDate && new Date(item.dueDate).getTime() < Date.now();
                      return (
                        <div key={item.id} className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs text-zinc-200 leading-relaxed flex-1">{item.description}</p>
                            <button
                              onClick={() => resolvePendingItem(item.id)}
                              title="Mark as done"
                              className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 cursor-pointer shrink-0"
                            >
                              ✓ Done
                            </button>
                          </div>
                          {item.dueDate && (
                            <span className={`text-[9px] font-bold uppercase ${isOverdue ? "text-rose-400" : "text-zinc-500"}`}>
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
                  <p className="text-xs text-zinc-500 animate-pulse">Generating summary...</p>
                </div>
              ) : activeDigest ? (
                <>
                  <div className="bg-zinc-950/40 p-4 border border-zinc-855 rounded-xl space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-zinc-500 font-bold uppercase">Sentiment</span>
                      <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded uppercase ${activeDigest.sentiment === "positive"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : activeDigest.sentiment === "negative"
                          ? "bg-rose-500/10 text-rose-400"
                          : "bg-zinc-800 text-zinc-400"
                        }`}>
                        {activeDigest.sentiment}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-zinc-500 font-bold uppercase">Priority</span>
                      <span className="text-xs font-semibold text-zinc-300 uppercase">{activeDigest.priority}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-zinc-500 font-bold uppercase">Category</span>
                      <span className="text-xs font-semibold text-zinc-300">{activeDigest.category}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase block">AI Summary</span>
                    <div className="p-4 bg-zinc-950/40 border border-zinc-850 rounded-xl text-xs text-zinc-300 leading-relaxed">
                      {activeDigest.summary}
                    </div>
                  </div>

                  {activeDigest.suggestedReply && (
                    <div className="space-y-2">
                      <span className="text-[10px] text-zinc-500 font-bold uppercase block">Suggested Reply</span>
                      <div className="p-4 bg-indigo-600/5 hover:bg-indigo-600/10 border border-indigo-500/20 rounded-xl text-xs text-indigo-200 leading-relaxed relative group">
                        <p className="italic">"{activeDigest.suggestedReply}"</p>
                        <button
                          onClick={() => setReplyText(activeDigest.suggestedReply || "")}
                          className="mt-3 w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded-lg transition-colors cursor-pointer border-0 uppercase tracking-wider"
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
            <div className="h-full flex items-center justify-center text-zinc-500 text-xs italic text-center">Select a conversation to see AI audit.</div>
          )}
        </div>
      </div>
    </div>
  );
}