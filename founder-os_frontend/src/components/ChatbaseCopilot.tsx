"use client";

import React, { useState, useRef, useEffect } from "react";
import Markdown from "./Markdown";

interface ChatProposal {
  kind: "comment" | "spec_fix";
  text?: string;
  scope?: string;
  itemIndex?: number;
  spec?: string;
  label: string;
}
interface ChatActivity { tool: string; label: string; }
interface ChatMsg { role: "user" | "assistant"; text: string; proposals?: ChatProposal[]; activity?: ChatActivity[]; }

const SUGGESTIONS = ["What's missing on this enquiry?", "Any past prices for these items?", "Summarize the discussion so far"];
const TOOL_ICON: Record<string, string> = {
  get_enquiry_summary: "📋",
  search_price_memory: "🔎",
  read_thread: "💬",
  propose_comment: "✍️",
  propose_spec_fix: "🛠️",
};

export default function ChatbaseCopilot({ enquiryId, open, onClose, onOpen, userInitial = "S" }: {
  enquiryId: string;
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  userInitial?: string;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [listening, setListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recogRef = useRef<any>(null);

  useEffect(() => { setMsgs([]); setConfirmed(new Set()); }, [enquiryId]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy, open]);

  // focus input when modal opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    if (!open) onOpen();
    setBusy(true);
    setMsgs((p) => [...p, { role: "user", text: q }]);
    setInput("");
    const tryStream = async (): Promise<boolean> => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 20000);
        const res = await fetch(`/api/enquiries/${enquiryId}/chat/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ message: q }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          if (res.status === 429) throw new Error("Rate-limited");
          throw new Error(`HTTP ${res.status} ${errText.slice(0,120)}`);
        }
        if (!res.body) throw new Error("no body");
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("text/event-stream")) throw new Error("not SSE");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accText = "";
        let accActivity: ChatActivity[] = [];
        let accProposals: ChatProposal[] = [];
        let sawDone = false;
        setMsgs((p) => [...p, { role: "assistant", text: "", activity: [], proposals: [] }]);
        const timeout = setTimeout(() => { try { reader.cancel(); } catch {} }, 18000);
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const raw of lines) {
              const line = raw.trim();
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (payload === "[DONE]") { sawDone = true; break; }
              try {
                const evt = JSON.parse(payload);
                if (evt.type === "delta" && typeof evt.data?.text === "string") {
                  accText += evt.data.text;
                  setMsgs((p) => {
                    const cp = [...p]; const last = cp[cp.length - 1];
                    if (last?.role === "assistant") last.text = accText;
                    return [...cp];
                  });
                } else if (evt.type === "activity" && evt.data) {
                  accActivity = [...accActivity, evt.data as ChatActivity];
                  setMsgs((p) => {
                    const cp = [...p]; const last = cp[cp.length - 1];
                    if (last?.role === "assistant") last.activity = [...accActivity];
                    return [...cp];
                  });
                } else if (evt.type === "done" && evt.data) {
                  accText = String(evt.data.reply ?? accText);
                  accActivity = Array.isArray(evt.data.activity) ? evt.data.activity : accActivity;
                  accProposals = Array.isArray(evt.data.proposals) ? evt.data.proposals : [];
                  setMsgs((p) => {
                    const cp = [...p]; const last = cp[cp.length - 1];
                    if (last?.role === "assistant") {
                      last.text = accText || "No answer.";
                      last.activity = accActivity;
                      last.proposals = accProposals;
                    }
                    return [...cp];
                  });
                  sawDone = true;
                } else if (evt.type === "error") {
                  setMsgs((p) => {
                    const cp = [...p]; const last = cp[cp.length - 1];
                    if (last?.role === "assistant" && !last.text) last.text = String(evt.data?.error || "No answer.");
                    return [...cp];
                  });
                }
              } catch {}
            }
            if (sawDone) break;
          }
        } finally {
          clearTimeout(timeout);
          clearTimeout(t);
          try { reader.releaseLock(); } catch {}
        }
        if (!accText && accProposals.length === 0 && accActivity.length === 0) throw new Error("empty stream");
        return true;
      } catch {
        setMsgs((p) => {
          const last = p[p.length - 1];
          if (last?.role === "assistant" && last.text === "" && last.proposals?.length === 0) return p.slice(0, -1);
          return p;
        });
        return false;
      }
    };
    const streamed = await tryStream();
    if (streamed) { setBusy(false); return; }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(`/api/enquiries/${enquiryId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        if (res.status === 429) throw new Error("Rate-limited — please wait a minute and retry.");
        throw new Error(errText || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setMsgs((p) => [...p, {
        role: "assistant",
        text: String(data.reply || data.error || "No answer."),
        proposals: Array.isArray(data.proposals) ? data.proposals : [],
        activity: Array.isArray(data.activity) ? data.activity : [],
      }]);
    } catch (e: any) {
      const msg = e?.name === "AbortError" ? "Chat timed out — please retry." : String(e?.message || "Chat failed — please retry.").slice(0, 200);
      setMsgs((p) => [...p, { role: "assistant", text: msg }]);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (msgIdx: number, pIdx: number, p: ChatProposal) => {
    const key = msgIdx * 100 + pIdx;
    if (confirmed.has(key)) return;
    try {
      const res = await fetch(`/api/enquiries/${enquiryId}/chat/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: p }),
      });
      const data = await res.json();
      if (data.applied && data.applied !== "none") {
        setConfirmed((s) => new Set(s).add(key));
        setMsgs((ms) => [...ms, { role: "assistant", text: `✓ ${p.label} — applied.` }]);
      } else {
        setMsgs((ms) => [...ms, { role: "assistant", text: `Could not apply: ${data.error || "rejected"}.` }]);
      }
    } catch {
      setMsgs((ms) => [...ms, { role: "assistant", text: "Apply failed — please retry." }]);
    }
  };

  const toggleMic = () => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      // fallback: focus input
      inputRef.current?.focus();
      return;
    }
    if (listening && recogRef.current) {
      try { recogRef.current.stop(); } catch {}
      setListening(false);
      return;
    }
    try {
      const rec = new SR();
      recogRef.current = rec;
      rec.lang = "en-IN";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onstart = () => setListening(true);
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      rec.onresult = (e: any) => {
        const transcript = e.results?.[0]?.[0]?.transcript as string | undefined;
        if (transcript) {
          setInput(transcript);
          // auto-send on voice? keep as typed, user taps send
          setTimeout(() => inputRef.current?.focus(), 50);
        }
        setListening(false);
      };
      rec.start();
    } catch {
      setListening(false);
    }
  };

  const handleRefresh = () => {
    setMsgs([]);
    setConfirmed(new Set());
  };

  return (
    <>
      {/* Backdrop when open */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" onClick={onClose} />
      )}

      {/* Floating chat window — widened to pill width */}
      {open && (
        <div
          className="fixed z-50 left-1/2 -translate-x-1/2 bottom-[84px] w-[min(560px,calc(100vw-24px))] h-[min(560px,calc(100vh-140px))] bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-in"
          role="dialog"
          aria-label="AI Agent"
          style={{ fontFamily: "'Geist', 'Outfit', Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-card)] bg-[var(--bg-card)]">
            <p className="text-[15px] font-bold text-[var(--text-primary)] tracking-tight">AI Agent</p>
            <button
              type="button"
              onClick={handleRefresh}
              aria-label="Refresh"
              title="Clear chat"
              className="p-1.5 rounded-full hover:bg-[var(--bg-input)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer border-0 bg-transparent"
            >
              <svg className="w-[16px] h-[16px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>

          {/* Messages — larger fonts, AI/User avatars */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-5 bg-[var(--bg-card)]">
            {msgs.length === 0 && !busy ? (
              <div className="space-y-3 py-2">
                <p className="text-[15px] font-medium leading-relaxed text-[var(--text-secondary)]">How can I help with this enquiry?</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="px-4 py-2 text-[13px] font-medium rounded-full border border-[var(--border-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] cursor-pointer bg-transparent text-left"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {msgs.map((m, mi) => (
                  <div key={mi} className="space-y-1">
                    {m.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="flex items-start gap-2.5 max-w-[85%]">
                          <div className="rounded-2xl rounded-br-md bg-[#3b82f6] text-white px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap font-medium shadow-sm">
                            {m.text}
                          </div>
                          <div className="h-8 w-8 rounded-full bg-[#3b82f6] flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0 mt-0.5">{String(userInitial).charAt(0).toUpperCase()}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2.5 items-start">
                        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white text-[11px] font-extrabold flex-shrink-0 mt-0.5 shadow-sm">AI</div>
                        <div className="flex-1 space-y-1.5 min-w-0">
                          {m.activity && m.activity.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {m.activity.map((a, ai) => (
                                <span key={ai} className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)] border border-[var(--border-card)]">
                                  <span>{TOOL_ICON[a.tool] ?? "⚙️"}</span>{a.label}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="bg-[var(--bg-input)]/90 dark:bg-[#252529] border border-[var(--border-card)]/50 rounded-2xl rounded-tl-md px-4 py-3.5 text-[15px] leading-relaxed text-[var(--text-primary)] font-[450]">
                            <Markdown text={m.text} />
                          </div>
                          <div className="flex items-center gap-2 text-[12px] text-[var(--text-tertiary)] px-1">
                            <span>Just now</span>
                          </div>
                          {m.proposals && m.proposals.length > 0 && (
                            <div className="space-y-1.5">
                              {m.proposals.map((p, pi) => {
                                const key = mi * 100 + pi;
                                const done = confirmed.has(key);
                                return (
                                  <div key={pi} className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 px-3.5 py-3">
                                    <p className="font-bold text-[13px] text-indigo-400">{p.label}</p>
                                    {(p.text || p.spec) && <p className="mt-1 text-[13px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{p.text || p.spec}</p>}
                                    <button type="button" disabled={done} onClick={() => void confirm(mi, pi, p)} className="mt-2.5 px-4 py-2 text-[13px] font-bold rounded-lg bg-indigo-500 text-white hover:opacity-90 disabled:opacity-50 cursor-pointer border-0">
                                      {done ? "✓ Applied" : "Confirm & apply"}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {busy && (
                  <div className="flex items-center gap-2.5 text-[13px] text-[var(--text-tertiary)] px-1">
                    <span className="inline-block h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Consulting the enquiry…
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Bottom pill — fixed center, hovered, dark */}
      <div className="fixed z-50 left-1/2 -translate-x-1/2 bottom-4 w-[min(560px,calc(100vw-24px))]">
        <div
          className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--border-card)] rounded-full px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.35)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.45)] transition-shadow"
          style={{ fontFamily: "'Geist', 'Outfit', Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" }}
          onClick={() => { if (!open) onOpen(); inputRef.current?.focus(); }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => { if (!open) onOpen(); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
            placeholder="Message..."
            className="flex-1 bg-transparent outline-none text-[15px] font-medium placeholder:text-[var(--text-tertiary)] text-[var(--text-primary)] px-2"
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleMic(); }}
            aria-label={listening ? "Stop listening" : "Voice input"}
            className={`p-2 rounded-full cursor-pointer border-0 flex items-center justify-center ${listening ? "bg-red-500 text-white animate-pulse" : "hover:bg-[var(--bg-input)] text-[var(--text-secondary)] bg-transparent"}`}
            title={listening ? "Listening…" : "Voice input"}
          >
            <svg className="w-[16px] h-[16px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 10a7 7 0 01-14 0M12 18v3M8 21h8" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void send(input); }}
            disabled={!input.trim() || busy}
            aria-label="Send"
            className="h-8 w-8 rounded-full bg-[#ececec] dark:bg-[#2a2a2e] border border-[var(--border-card)] flex items-center justify-center text-[var(--text-secondary)] hover:bg-white dark:hover:bg-[#3a3a3e] disabled:opacity-40 cursor-pointer"
          >
            <svg className="w-[14px] h-[14px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h12M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
