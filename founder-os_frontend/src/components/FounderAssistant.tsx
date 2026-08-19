"use client";

import React, { useState, useEffect, useRef } from "react";

export default function FounderAssistant() {
  const [briefing, setBriefing] = useState<string>("");
  const [digests, setDigests] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [chatMessages, setChatMessages] = useState<Array<{ sender: "user" | "assistant"; text: string }>>([
    {
      sender: "assistant",
      text: "Company Brain is ready. Ask me anything about your customers, quotations, emails, or sales pipeline — I'll search across all your data.",
    },
  ]);
  const [chatInput, setChatInput] = useState<string>("");
  const [isBriefingLoading, setIsBriefingLoading] = useState<boolean>(true);
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Parse custom markdown helper
  const parseMarkdown = (md: string) => {
    if (!md) return "";
    return md
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-6 mb-4 text-white">$1</h1>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-bold mt-5 mb-3 text-white border-b border-white/10 pb-2">$1</h2>')
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-4 mb-2 text-indigo-300">$1</h3>')
      .replace(/^\- (.*$)/gim, '<li class="ml-4 list-disc text-zinc-300 mb-1">$1</li>')
      .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
      .replace(/\[x\] (.*?)(?:<br>|$)/gim, '<span class="text-emerald-500 font-bold mr-2">✔</span> <span class="text-zinc-400">$1</span><br>')
      .replace(/\[ \] (.*?)(?:<br>|$)/gim, '<span class="text-amber-500 font-bold mr-2">⏱</span> <span class="text-zinc-300">$1</span><br>')
      .replace(/\n/g, "<br>");
  };

  const fetchBriefing = async () => {
    setIsBriefingLoading(true);
    try {
      const res = await fetch("/api/brief/latest");
      if (res.status === 404) {
        setBriefing("No briefings generated yet. Click 'Regenerate Briefing' to create one.");
        return;
      }
      const data = await res.json();
      setBriefing(data.content);
    } catch (e) {
      setBriefing("Error loading briefing logs.");
    } finally {
      setIsBriefingLoading(false);
    }
  };

  const fetchDigests = async () => {
    try {
      const res = await fetch("/api/digests");
      const data = await res.json();
      setDigests(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchTasks = async () => {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      setTasks(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchBriefing();
    fetchDigests();
    fetchTasks();
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = chatInput.trim();
    if (!query) return;

    setChatMessages((prev) => [...prev, { sender: "user", text: query }]);
    setChatInput("");
    setIsChatLoading(true);

    try {
      const res = await fetch("/api/ask-founder-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: query }),
      });
      const data = await res.json();
      setChatMessages((prev) => [...prev, { sender: "assistant", text: data.answer }]);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        { sender: "assistant", text: "Failed to connect to the assistant server." },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const getPriorityBadgeClass = (p: string) => {
    p = (p || "").toLowerCase();
    if (p === "urgent" || p === "high") return "bg-red-500/10 text-red-400 border border-red-500/20";
    if (p === "medium") return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
    return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
  };

  return (
    <div className="space-y-6 text-zinc-100 pb-12">
      {/* Top Bar Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-800 pb-5">
        <div>
          <h1 className="text-3xl font-bold font-heading text-white">Founder AI Assistant</h1>
          <p className="text-sm text-zinc-400">Contextual briefings & AI workflow executions</p>
        </div>
      </div>

      {/* Main OS Interface Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Briefing & Chat */}
        <div className="lg:col-span-2 space-y-6">
          {/* Briefing Section */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-4 mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span>📅</span> Latest Morning Briefing
              </h3>
            </div>
            {isBriefingLoading ? (
              <div className="py-12 text-center text-zinc-500 animate-pulse">Loading briefing context...</div>
            ) : (
              <div
                className="text-zinc-300 leading-relaxed text-sm overflow-x-auto space-y-2"
                dangerouslySetInnerHTML={{ __html: parseMarkdown(briefing) }}
              />
            )}
          </section>

          {/* AI Chatbot */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md flex flex-col h-[500px]">
            <div className="border-b border-zinc-800 pb-4 mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span>🤖</span> Ask AI Chief of Staff
              </h3>
              <p className="text-xs text-zinc-500">Powered by Company Brain — searches across WhatsApp, Email, Zoho estimates, and sales comments</p>
            </div>
            <div ref={chatContainerRef} className="flex-grow overflow-y-auto space-y-4 pr-2 mb-4 scrollbar-thin">
              {chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      msg.sender === "user"
                        ? "bg-indigo-600 text-white rounded-tr-none shadow-md"
                        : "bg-zinc-800 text-zinc-100 rounded-tl-none border border-zinc-700/50"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-zinc-800 text-zinc-500 rounded-2xl px-4 py-2.5 text-sm rounded-tl-none border border-zinc-700/50 animate-pulse">
                    Thinking...
                  </div>
                </div>
              )}
            </div>
            <form onSubmit={handleChatSubmit} className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask: 'What happened with Bühler?' or 'Which customers confirmed orders?'"
                className="flex-grow bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder-zinc-500"
              />
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm rounded-xl px-5 transition-all shadow-md shadow-indigo-600/10 cursor-pointer"
              >
                Send
              </button>
            </form>
          </section>
        </div>

        {/* Right Col: Digests & Tasks */}
        <div className="space-y-6">
          {/* Action Tasks checklist */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md">
            <h3 className="text-lg font-bold text-white border-b border-zinc-800 pb-4 mb-4 flex items-center gap-2">
              <span>📋</span> Active Task Backlog
            </h3>
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {tasks.length === 0 ? (
                <div className="text-center py-6 text-zinc-500 text-sm">No pending action items found.</div>
              ) : (
                tasks.slice(0, 8).map((task) => (
                  <div
                    key={task.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                      task.status === "COMPLETED"
                        ? "bg-emerald-950/20 border-emerald-900/30 line-through text-zinc-500"
                        : "bg-zinc-950/40 border-zinc-800 hover:border-zinc-700 text-zinc-200"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={task.status === "COMPLETED"}
                      readOnly
                      className="mt-1 accent-indigo-500 rounded border-zinc-700 bg-zinc-800"
                    />
                    <div className="flex-grow min-w-0">
                      <span className="text-xs font-semibold block truncate leading-none mb-1">
                        {task.title}
                      </span>
                      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                        <span>Owner: <strong>{task.owner}</strong></span>
                        <span>•</span>
                        <span className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400 font-mono text-[9px] uppercase">
                          {task.source}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* High Priority Digests */}
          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md">
            <h3 className="text-lg font-bold text-white border-b border-zinc-800 pb-4 mb-4 flex items-center gap-2">
              <span>🚨</span> Chat Summaries
            </h3>
            <div className="space-y-4 max-h-[450px] overflow-y-auto pr-1">
              {digests.length === 0 ? (
                <div className="text-center py-6 text-zinc-500 text-sm">
                  No digests compiled. Run a WhatsApp digest job to scan conversations!
                </div>
              ) : (
                digests.slice(0, 4).map((d) => (
                  <div
                    key={d.id}
                    className="p-4 bg-zinc-950/40 border border-zinc-800/80 rounded-xl space-y-2 hover:border-zinc-700 transition-all"
                  >
                    <div className="flex justify-between items-center gap-2">
                      <span className="font-bold text-sm text-zinc-200 truncate">{d.chatName}</span>
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${getPriorityBadgeClass(d.priority)}`}>
                        {d.priority}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed line-clamp-3">
                      {d.summary}
                    </p>
                    {d.requiresFounder && (
                      <span className="inline-block text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded font-semibold uppercase">
                        Requires Attention
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
