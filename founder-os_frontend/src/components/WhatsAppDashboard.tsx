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
}

interface RawMessage {
  id: string;
  chatId: string;
  sender: string;
  body: string;
  timestamp: string;
  processed: boolean;
}

interface Campaign {
  campaign_uid: string;
  title: string;
  template_name: string;
  target_count: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  status: string;
  created_at: string;
}

interface Group {
  group_uid: string;
  uid?: string;
  id?: string;
  name: string;
  description: string;
}

interface Template {
  name: string;
  language: string;
  category: string;
  body: string;
}

export default function WhatsAppDashboard() {
  // Navigation & Sub-tab navigation
  const [activeTab, setActiveTab] = useState<"inbox" | "campaigns" | "groups" | "settings">("inbox");
  const [inboxCategory, setInboxCategory] = useState<"all" | "urgent" | "leads" | "support">("all");

  // Credentials config
  const [vendorUid, setVendorUid] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("wa_vendor_uid") || "b35c07b9-99fa-4224-a7f3-1ea587cb2e64";
    }
    return "b35c07b9-99fa-4224-a7f3-1ea587cb2e64";
  });
  const [bearerToken, setVendorToken] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("wa_bearer_token") || "aNxAArZ6ahSs81ogk4rZXgk1C8f7jJ66PtbkDOmlRVORWRMt0ZT9VJTA6Gmw2Ua8";
    }
    return "aNxAArZ6ahSs81ogk4rZXgk1C8f7jJ66PtbkDOmlRVORWRMt0ZT9VJTA6Gmw2Ua8";
  });

  // State data
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [digests, setDigests] = useState<Digest[]>([]);
  const [selectedContactUid, setSelectedContactUid] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<RawMessage[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  // Composer fields
  const [replyText, setReplyText] = useState("");
  const [isSending, setIsSending] = useState(false);

  // New Campaign Form Fields
  const [campaignTitle, setCampaignTitle] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);

  // New Group Form Fields
  const [groupName, setGroupName] = useState("");
  const [groupDesc, setGroupDesc] = useState("");
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  // Loading states
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);

  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  // Memoized array normalizers to prevent "xxx.reduce/map is not a function" errors
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
    
    // Sort oldest-to-newest (so latest message is shown below)
    return [...list].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [chatMessages]);

  const campaignList = useMemo<Campaign[]>(() => {
    if (Array.isArray(campaigns)) return campaigns;
    if (campaigns && Array.isArray((campaigns as any).campaigns)) return (campaigns as any).campaigns;
    if (campaigns && Array.isArray((campaigns as any).data)) return (campaigns as any).data;
    return [];
  }, [campaigns]);

  const groupList = useMemo<Group[]>(() => {
    if (Array.isArray(groups)) return groups;
    if (groups && Array.isArray((groups as any).groups)) return (groups as any).groups;
    if (groups && Array.isArray((groups as any).data)) return (groups as any).data;
    return [];
  }, [groups]);

  const templateList = useMemo<Template[]>(() => {
    if (Array.isArray(templates)) return templates;
    if (templates && Array.isArray((templates as any).templates)) return (templates as any).templates;
    if (templates && Array.isArray((templates as any).data)) return (templates as any).data;
    return [];
  }, [templates]);

  // Get custom headers
  const getHeaders = () => {
    return {
      "Content-Type": "application/json",
      "x-wa-vendor-uid": vendorUid,
      "x-wa-bearer-token": bearerToken,
    };
  };

  // 1. Fetch live contacts from WA Engine Plus
  const fetchContacts = async () => {
    setIsLoadingContacts(true);
    try {
      const res = await fetch("/api/whatsapp/contacts", { headers: getHeaders() });
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

  // 2. Fetch cached summaries (digests)
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

  // 3. Fetch live message history for selected contact
  const fetchMessages = async (contactUid: string, isSilent = false) => {
    if (!isSilent) {
      setIsLoadingMessages(true);
    }
    try {
      const res = await fetch(`/api/whatsapp/contacts/${contactUid}/messages`, { headers: getHeaders() });
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

  // 4. Summarize live contact history on-the-fly
  const generateContactSummary = async (contactUid: string) => {
    setIsSummarizing(true);
    try {
      const res = await fetch(`/api/whatsapp/contacts/${contactUid}/summarize`, {
        method: "POST",
        headers: getHeaders()
      });
      if (res.ok) {
        const newDigest = await res.json();
        // Insert or replace in digests list
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

  // 5. Fetch Campaigns
  const fetchCampaigns = async () => {
    try {
      const res = await fetch("/api/whatsapp/campaigns", { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data);
      }
    } catch (err) {
      console.error("Failed to fetch campaigns:", err);
    }
  };

  // 6. Fetch Groups
  const fetchGroups = async () => {
    try {
      const res = await fetch("/api/whatsapp/groups", { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setGroups(data);
        const fetchedGroups = Array.isArray(data) ? data : data.groups || [];
        if (fetchedGroups.length > 0 && !selectedGroup) {
          const firstGroupUid = fetchedGroups[0].group_uid || fetchedGroups[0].uid || fetchedGroups[0].id || "";
          setSelectedGroup(firstGroupUid);
        }
      }
    } catch (err) {
      console.error("Failed to fetch groups:", err);
    }
  };

  // 7. Fetch Templates
  const fetchTemplates = async () => {
    try {
      const res = await fetch("/api/whatsapp/templates", { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
        const fetchedTemplates = Array.isArray(data) ? data : data.templates || [];
        if (fetchedTemplates.length > 0 && !selectedTemplate) {
          setSelectedTemplate(fetchedTemplates[0].name);
        }
      }
    } catch (err) {
      console.error("Failed to fetch templates:", err);
    }
  };

  // Run initial loadings
  useEffect(() => {
    fetchContacts();
    fetchDigests();
    fetchCampaigns();
    fetchGroups();
    fetchTemplates();
  }, []);

  // Fetch messages and check summary when selected contact changes
  useEffect(() => {
    if (selectedContactUid) {
      fetchMessages(selectedContactUid);
      // If no cached digest summary exists, trigger generation automatically
      const exists = digestList.some(d => d.id === selectedContactUid || d.chatId === selectedContactUid);
      if (!exists) {
        generateContactSummary(selectedContactUid);
      }
    }
  }, [selectedContactUid, digestList]);

  // Scroll to bottom of chat pane ONLY (without scrolling the entire browser page)
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messageList, isLoadingMessages]);

  // Set up EventSource for Server-Sent Events (SSE) to receive real-time webhook updates
  useEffect(() => {
    const eventSource = new EventSource("/api/whatsapp/events");

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === "message.received") {
          const msg = payload.data;
          
          // Check if the incoming message belongs to the currently active conversation
          const isActive = selectedContactUid && (
            msg.chatId === selectedContactUid || 
            msg.chatId.replace(/[^0-9]/g, '') === selectedContactUid.replace(/[^0-9]/g, '')
          );
          
          if (isActive) {
            // Append the new message to the local chat messages list in real-time
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
                  timestamp: msg.timestamp
                }
              ];
            });
          }
          
          // Silently refresh contacts and digests lists to update indicators / summaries
          fetchDigests();
          fetchContacts();
        } else if (payload.event === "message.classified") {
          fetchDigests();
          fetchContacts();
          if (payload.data.chatId === selectedContactUid) {
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

  // Save Settings Credentials
  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem("wa_vendor_uid", vendorUid);
    localStorage.setItem("wa_bearer_token", bearerToken);
    alert("⚙️ WhatsApp credentials successfully updated!");
    fetchContacts();
    fetchCampaigns();
    fetchGroups();
    fetchTemplates();
  };

  // Send Reply Message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedContactUid || isSending) return;

    setIsSending(true);
    const bodyText = replyText;
    setReplyText("");

    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          phone_number: selectedContactUid.split("@")[0],
          message_body: bodyText,
        }),
      });

      if (res.ok) {
        await fetchMessages(selectedContactUid);
      } else {
        alert("Failed to send message via API gateway.");
      }
    } catch (err) {
      console.error("Send message error:", err);
    } finally {
      setIsSending(false);
    }
  };

  // Launch Template Campaign Blast
  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campaignTitle.trim() || !selectedTemplate || isCreatingCampaign) return;

    setIsCreatingCampaign(true);
    try {
      const res = await fetch("/api/whatsapp/campaigns/create", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          title: campaignTitle,
          template_name: selectedTemplate,
          template_language: "en",
          group_uid: selectedGroup,
          scheduled_at: new Date(Date.now() + 60000).toISOString().replace("T", " ").slice(0, 19),
        }),
      });

      if (res.ok) {
        alert("🚀 Campaign blast successfully dispatched to WA Engine!");
        setCampaignTitle("");
        fetchCampaigns();
      } else {
        alert("Failed to register campaign.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsCreatingCampaign(false);
    }
  };

  // Create Contact Group Segment
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim() || isCreatingGroup) return;

    setIsCreatingGroup(true);
    try {
      const res = await fetch("/api/whatsapp/groups/create", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          name: groupName,
          description: groupDesc,
        }),
      });

      if (res.ok) {
        alert("✅ Customer segment group created successfully!");
        setGroupName("");
        setGroupDesc("");
        fetchGroups();
      } else {
        alert("Failed to create group.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsCreatingGroup(false);
    }
  };

  // Active digest details
  const activeDigest = useMemo(() => {
    return digestList.find((d) => d.id === selectedContactUid || d.chatId === selectedContactUid) || null;
  }, [digestList, selectedContactUid]);

  // Filtered contacts based on category tabs, sorted by latest message digest activity
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
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-800 pb-5">
        <div>
          <h1 className="text-3xl font-bold font-heading text-white flex items-center gap-2">
            <span>💬</span> WhatsApp Automation Hub
          </h1>
          <p className="text-sm text-zinc-400">Campaign management, AI chat digests, and instant agent response portal</p>
        </div>
        <div className="flex bg-zinc-950/40 p-1 border border-zinc-800 rounded-xl">
          <button
            onClick={() => setActiveTab("inbox")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all border-0 cursor-pointer ${
              activeTab === "inbox" ? "bg-indigo-600 text-white shadow" : "text-zinc-400 hover:text-white bg-transparent"
            }`}
          >
            📥 Inbox Summary
          </button>
          <button
            onClick={() => setActiveTab("campaigns")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all border-0 cursor-pointer ${
              activeTab === "campaigns" ? "bg-indigo-600 text-white shadow" : "text-zinc-400 hover:text-white bg-transparent"
            }`}
          >
            📢 Campaigns
          </button>
          <button
            onClick={() => setActiveTab("groups")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all border-0 cursor-pointer ${
              activeTab === "groups" ? "bg-indigo-600 text-white shadow" : "text-zinc-400 hover:text-white bg-transparent"
            }`}
          >
            🗂️ Segments & Groups
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all border-0 cursor-pointer ${
              activeTab === "settings" ? "bg-indigo-600 text-white shadow" : "text-zinc-400 hover:text-white bg-transparent"
            }`}
          >
            ⚙️ Connection Settings
          </button>
        </div>
      </div>

      {/* Tab View: Inbox Summaries */}
      {activeTab === "inbox" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[800px]">
          {/* Left panel: Live Contacts queue */}
          <div className="lg:col-span-4 bg-zinc-900/30 border border-zinc-800/80 rounded-2xl flex flex-col overflow-hidden">
            {/* Category tabs */}
            <div className="flex border-b border-zinc-850 p-2 overflow-x-auto gap-1 select-none">
              {(["all", "urgent", "leads", "support"] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setInboxCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wider transition-all border-0 cursor-pointer ${
                    inboxCategory === cat
                      ? "bg-zinc-800 text-white border border-zinc-700"
                      : "text-zinc-500 hover:text-zinc-300 bg-transparent"
                  }`}
                >
                  {cat === "all" ? "All" : cat === "urgent" ? "🚨 Urgent" : cat === "leads" ? "💡 Leads" : "💬 Support"}
                </button>
              ))}
            </div>

            {/* Contacts List */}
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-850 scrollbar-thin">
              {isLoadingContacts ? (
                <div className="p-8 text-center text-zinc-500 animate-pulse text-xs">Loading live contacts...</div>
              ) : filteredContacts.length === 0 ? (
                <div className="p-8 text-center text-zinc-500 text-xs italic">No contacts found in this segment.</div>
              ) : (
                filteredContacts.map((c, index) => {
                  const digest = digestList.find((d) => d.id === c.uid || d.chatId === c.uid);
                  const isSelected = selectedContactUid === c.uid;
                  return (
                    <div
                      key={c.uid || index}
                      onClick={() => setSelectedContactUid(c.uid)}
                      className={`p-4 cursor-pointer hover:bg-zinc-850/50 transition-all space-y-2 border-l-4 ${
                        isSelected ? "bg-zinc-850/60 border-l-indigo-500" : "border-l-transparent"
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-sm text-zinc-100 block">{c.name || c.phone_number}</span>
                        <span className="text-[10px] text-zinc-500">{c.phone_number}</span>
                      </div>
                      
                      {digest ? (
                        <>
                          <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">{digest.summary}</p>
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded ${
                              digest.priority === "urgent" || digest.priority === "high"
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
                        <p className="text-xs text-zinc-500 italic">Click to query & generate AI audit summary...</p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Center panel: Interactive Chat Messages thread */}
          <div className="lg:col-span-5 bg-zinc-900/30 border border-zinc-800/80 rounded-2xl flex flex-col overflow-hidden h-full">
            {selectedContactUid ? (
              <>
                {/* Chat Header */}
                <div className="p-4 border-b border-zinc-850 flex items-center justify-between bg-zinc-950/20">
                  <div>
                    <h3 className="font-extrabold text-white text-sm">
                      {contactList.find(c => c.uid === selectedContactUid)?.name || selectedContactUid}
                    </h3>
                    <p className="text-[10px] text-zinc-500 mt-0.5">Contact UID: <span className="font-mono text-[9px]">{selectedContactUid}</span></p>
                  </div>
                  <button
                    onClick={() => generateContactSummary(selectedContactUid)}
                    disabled={isSummarizing}
                    className="px-2.5 py-1 text-[10px] bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 font-extrabold rounded border border-indigo-500/30 cursor-pointer"
                  >
                    {isSummarizing ? "🔄 Auditing..." : "⚡ Re-Audit Summary"}
                  </button>
                </div>

                {/* Messages pane */}
                <div ref={chatContainerRef} className="flex-1 p-4 overflow-y-auto space-y-4 bg-zinc-955/10 scrollbar-thin">
                  {isLoadingMessages ? (
                    <div className="h-full flex items-center justify-center text-zinc-500 text-xs animate-pulse">Loading live message history...</div>
                  ) : messageList.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-zinc-500 text-xs italic">No messages synced in this thread yet.</div>
                  ) : (
                    messageList.map((msg, index) => {
                      const isMe = msg.sender === "You";
                      return (
                        <div key={msg.id || index} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-xs shadow-sm leading-relaxed ${
                            isMe
                              ? "bg-indigo-600 text-white rounded-br-none"
                              : "bg-zinc-800/90 text-zinc-100 rounded-bl-none border border-zinc-700/50"
                          }`}>
                            {!isMe && (
                              <span className="text-[9px] font-extrabold text-indigo-400 block mb-1 uppercase tracking-wider">
                                {contactList.find(c => c.uid === selectedContactUid)?.name || "Client"}
                              </span>
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

                {/* Composer */}
                <form onSubmit={handleSendMessage} className="p-4 border-t border-zinc-850 bg-zinc-950/20 flex gap-2">
                  <textarea
                    rows={2}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={`Reply to client...`}
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

          {/* Right panel: AI Summaries */}
          <div className="lg:col-span-3 bg-zinc-900/30 border border-zinc-800/80 rounded-2xl p-5 flex flex-col space-y-5 overflow-y-auto scrollbar-thin">
            {selectedContactUid ? (
              <>
                <div>
                  <h3 className="font-extrabold text-white text-sm flex items-center gap-1.5 pb-2 border-b border-zinc-850">
                    <span>🧠</span> AI Conversation Audit
                  </h3>
                </div>

                {isSummarizing ? (
                  <div className="py-20 text-center space-y-3">
                    <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                    <p className="text-xs text-zinc-500 animate-pulse">Groq compiling live history audit...</p>
                  </div>
                ) : activeDigest ? (
                  <>
                    {/* Sentiment card */}
                    <div className="bg-zinc-950/40 p-4 border border-zinc-855 rounded-xl space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase">Sentiment</span>
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded uppercase ${
                          activeDigest.sentiment === "positive"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : activeDigest.sentiment === "negative"
                            ? "bg-rose-500/10 text-rose-400"
                            : "bg-zinc-800 text-zinc-400"
                        }`}>
                          {activeDigest.sentiment}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase">Priority Segment</span>
                        <span className="text-xs font-semibold text-zinc-300 uppercase">{activeDigest.priority}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase">Category Tag</span>
                        <span className="text-xs font-semibold text-zinc-300">{activeDigest.category}</span>
                      </div>
                    </div>

                    {/* Executive Summary */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-zinc-500 font-bold uppercase block">AI Executive Summary</span>
                      <div className="p-4 bg-zinc-950/40 border border-zinc-850 rounded-xl text-xs text-zinc-300 leading-relaxed">
                        {activeDigest.summary}
                      </div>
                    </div>

                    {/* AI Suggested Response */}
                    {activeDigest.suggestedReply && (
                      <div className="space-y-2">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase block">AI Suggested Quick Response</span>
                        <div className="p-4 bg-indigo-600/5 hover:bg-indigo-600/10 border border-indigo-500/20 rounded-xl text-xs text-indigo-200 leading-relaxed relative group">
                          <p className="italic">"{activeDigest.suggestedReply}"</p>
                          <button
                            onClick={() => setReplyText(activeDigest.suggestedReply || "")}
                            className="mt-3 w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded-lg transition-colors cursor-pointer border-0 uppercase tracking-wider"
                          >
                            ⚡ Use AI Response
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-20 text-center text-zinc-550 text-xs italic">
                    No summary generated. Click "Re-Audit Summary" in the header to compile.
                  </div>
                )}
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-500 text-xs italic text-center">AI audit analytics load upon selecting a conversation.</div>
            )}
          </div>
        </div>
      )}

      {/* Tab View: Campaign Automation */}
      {activeTab === "campaigns" && (
        <div className="space-y-6">
          {/* KPI Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-5 shadow-sm">
              <span className="text-xs text-zinc-400 block mb-1">Total Campaigns Blasts</span>
              <span className="text-2xl font-bold text-white block">{campaignList.length}</span>
            </div>
            <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-5 shadow-sm">
              <span className="text-xs text-zinc-400 block mb-1">Accumulated Target</span>
              <span className="text-2xl font-bold text-white block">
                {campaignList.reduce((sum, c) => sum + (c.target_count || 0), 0)} recipients
              </span>
            </div>
            <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-5 shadow-sm">
              <span className="text-xs text-zinc-400 block mb-1">Delivered Messages</span>
              <span className="text-2xl font-bold text-emerald-400 block">
                {campaignList.reduce((sum, c) => sum + (c.delivered_count || 0), 0)}
              </span>
            </div>
            <div className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-5 shadow-sm">
              <span className="text-xs text-zinc-400 block mb-1">Avg. Read Rate</span>
              <span className="text-2xl font-bold text-indigo-400 block">
                {campaignList.length > 0
                  ? Math.round(
                      (campaignList.reduce((sum, c) => sum + (c.read_count || 0), 0) /
                        (campaignList.reduce((sum, c) => sum + (c.delivered_count || 1), 0) || 1)) *
                        100
                    )
                  : 0}
                %
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Create Campaign form */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md space-y-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>🚀</span> Launch Campaign Blast
                </h3>
                <p className="text-xs text-zinc-500">Initiate automated template campaigns via WA Engine Plus gateway</p>
              </div>

              <form onSubmit={handleCreateCampaign} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-300">Campaign Title</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Diwali Push 2026"
                    value={campaignTitle}
                    onChange={(e) => setCampaignTitle(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-300">Target Group Segment</label>
                  <select
                    value={selectedGroup}
                    onChange={(e) => setSelectedGroup(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    {groupList.map((g, index) => (
                      <option key={g.group_uid || g.uid || g.id || index} value={g.group_uid || g.uid || g.id}>
                        {g.name} ({g.description})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-300">Approved Template</label>
                  <select
                    value={selectedTemplate}
                    onChange={(e) => setSelectedTemplate(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    {templateList.map((t, index) => (
                      <option key={t.name || index} value={t.name}>
                        {t.name} ({t.category})
                      </option>
                    ))}
                  </select>
                </div>

                {selectedTemplate && (
                  <div className="p-3 bg-zinc-950/60 border border-zinc-850 rounded-xl space-y-1">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase block">Template Body Preview</span>
                    <p className="text-[11px] text-zinc-400 leading-relaxed italic">
                      {templateList.find((t) => t.name === selectedTemplate)?.body}
                    </p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isCreatingCampaign || !campaignTitle.trim()}
                  className="w-full py-2.5 bg-indigo-650 hover:bg-indigo-555 text-white font-bold rounded-lg text-xs transition-colors cursor-pointer border-0 shadow-lg shadow-indigo-600/25 disabled:opacity-40"
                >
                  {isCreatingCampaign ? "Scheduling..." : "🚀 Disptach Template Blast"}
                </button>
              </form>
            </div>

            {/* Campaign lists table */}
            <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md flex flex-col">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <span>📋</span> Campaign Broadcast Logs
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-zinc-850 text-zinc-500">
                      <th className="p-3">Campaign Title</th>
                      <th className="p-3">Template Name</th>
                      <th className="p-3">Recipients</th>
                      <th className="p-3">Delivered</th>
                      <th className="p-3">Read Rate</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-850/60">
                    {campaignList.map((c, index) => {
                      const readRate = c.delivered_count > 0 ? Math.round((c.read_count / c.delivered_count) * 100) : 0;
                      return (
                        <tr key={c.campaign_uid || index} className="hover:bg-zinc-850/20 text-zinc-300 transition-colors">
                          <td className="p-3 font-semibold text-white">{c.title}</td>
                          <td className="p-3 font-mono text-zinc-455">{c.template_name}</td>
                          <td className="p-3">{c.target_count}</td>
                          <td className="p-3 text-emerald-400 font-bold">{c.delivered_count}</td>
                          <td className="p-3 font-mono">{readRate}%</td>
                          <td className="p-3">
                            <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded uppercase ${
                              c.status === "Completed"
                                ? "bg-emerald-500/10 text-emerald-400"
                                : "bg-amber-500/10 text-amber-400 animate-pulse"
                            }`}>
                              {c.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab View: Group Segments */}
      {activeTab === "groups" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Create group form */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md space-y-4">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span>➕</span> Create Segment Group
              </h3>
              <p className="text-xs text-zinc-500">Configure new user cohorts for automated target messaging campaigns</p>
            </div>

            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300">Segment Group Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. VIP Customers"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300">Description</label>
                <textarea
                  rows={3}
                  placeholder="Describe segment criteria..."
                  value={groupDesc}
                  onChange={(e) => setGroupDesc(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={isCreatingGroup || !groupName.trim()}
                className="w-full py-2.5 bg-indigo-650 hover:bg-indigo-555 text-white font-bold rounded-lg text-xs transition-colors cursor-pointer border-0 disabled:opacity-40"
              >
                {isCreatingGroup ? "Creating..." : "Create Cohort Segment"}
              </button>
            </form>
          </div>

          {/* Group lists table */}
          <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md flex flex-col">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <span>🗂️</span> Saved Cohorts & Target Groups
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-850 text-zinc-500">
                    <th className="p-3">Group Name</th>
                    <th className="p-3">Group UID</th>
                    <th className="p-3">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850/60">
                  {groupList.map((g, index) => (
                    <tr key={g.group_uid || g.uid || g.id || index} className="hover:bg-zinc-850/20 text-zinc-300 transition-colors">
                      <td className="p-3 font-semibold text-white">{g.name}</td>
                      <td className="p-3 font-mono text-zinc-455 select-all">{g.group_uid || g.uid || g.id}</td>
                      <td className="p-3 text-zinc-400">{g.description || "No description set"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab View: Settings */}
      {activeTab === "settings" && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md max-w-xl mx-auto space-y-6">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <span>⚙️</span> WA Engine Plus Settings
            </h3>
            <p className="text-xs text-zinc-400 mt-1">Configure your plus.waengine.in developer API keys for campaigns access</p>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-300">Vendor UID</label>
              <input
                type="text"
                required
                value={vendorUid}
                onChange={(e) => setVendorUid(e.target.value)}
                placeholder="UID from WA Engine Settings"
                className="w-full bg-zinc-950 border border-zinc-850 rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-300">Bearer Access Token</label>
              <input
                type="password"
                required
                value={bearerToken}
                onChange={(e) => setVendorToken(e.target.value)}
                placeholder="Access Token from WA Engine Settings"
                className="w-full bg-zinc-955 border border-zinc-850 rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs transition-colors cursor-pointer border-0 shadow-lg shadow-indigo-600/20"
            >
              Save Credentials & Connect API
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
