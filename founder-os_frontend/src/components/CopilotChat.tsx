"use client";

// CopilotChat — reusable AI-copilot interface (same look/behavior everywhere).
//
// One component, many departments: the caller passes a CopilotConfig (titles,
// suggestions, tool icons, endpoint URLs). Sales keeps its own ChatbaseCopilot
// untouched; new departments (product line, ...) mount this with their config.
// Backend mirror: founder-os_backend/src/copilot/registry.ts
import React, { useState, useRef, useEffect } from "react";
import Markdown from "./Markdown";

export interface CopilotProposal {
  kind: string;
  label: string;
  text?: string;
  spec?: string;
}

interface CopilotActivity { tool: string; label: string; }
interface CopilotMsg { role: "user" | "assistant"; text: string; proposals?: CopilotProposal[]; activity?: CopilotActivity[]; }

export interface CopilotConfig {
  title: string;
  subtitle: string;
  emptyText: string;
  suggestions: string[];
  toolIcons: Record<string, string>;
  streamUrl: string;
  chatUrl: string;
  /** New-chat endpoint: wipes server history + drafts. Absent = local clear only. */
  clearUrl?: string;
  /** Absent = read-only copilot (no Confirm & apply cards). */
  executeUrl?: string;
  /** Chat clears whenever this changes (e.g. selected enquiry/product id). */
  resetKey: string | number;
  userInitial?: string;
}

export default function CopilotChat({ config, open, onClose, onOpen, chrome = "full", modes, mode, onModeChange }: {
  config: CopilotConfig;
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  /** "full" = popup + bottom pill; "popup" = popup only (caller renders its own launcher). */
  chrome?: "full" | "popup";
  /** Mode tabs shown inside the popup header (e.g. Knowledge | Add Rates). */
  modes?: { id: string; label: string }[];
  mode?: string;
  onModeChange?: (id: string) => void;
}) {
  const userInitial = config.userInitial ?? "S";
  const [msgs, setMsgs] = useState<CopilotMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [listening, setListening] = useState(false);
  const [visible, setVisible] = useState(open);
  const [exiting, setExiting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recogRef = useRef<any>(null);

  useEffect(() => { setMsgs([]); setConfirmed(new Set()); }, [config.resetKey]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy, open, visible]);
  useEffect(() => {
    if (open) { setVisible(true); setExiting(false); setTimeout(() => inputRef.current?.focus(), 120); }
    else if (visible) {
      setExiting(true);
      const t = setTimeout(() => { setVisible(false); setExiting(false); }, 260);
      return () => clearTimeout(t);
    }
  }, [open, visible]);

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
        // 60s budget: the primary may be throttled and the turn can fail over
        // to a reasoning-model fallback running a multi-step tools loop.
        const t = setTimeout(() => ctrl.abort(), 60000);
        const res = await fetch(config.streamUrl, {
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
        let accActivity: CopilotActivity[] = [];
        let accProposals: CopilotProposal[] = [];
        let sawDone = false;
        setMsgs((p) => [...p, { role: "assistant", text: "", activity: [], proposals: [] }]);
        const timeout = setTimeout(() => { try { reader.cancel(); } catch {} }, 55000);
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
                  accActivity = [...accActivity, evt.data as CopilotActivity];
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
      const t = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(config.chatUrl, {
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

  const confirm = async (msgIdx: number, pIdx: number, p: CopilotProposal) => {
    if (!config.executeUrl) return;
    const key = msgIdx * 100 + pIdx;
    if (confirmed.has(key)) return;
    try {
      const res = await fetch(config.executeUrl, {
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
    if (!SR) { inputRef.current?.focus(); return; }
    if (listening && recogRef.current) { try { recogRef.current.stop(); } catch {} setListening(false); return; }
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
        if (transcript) { setInput(transcript); setTimeout(() => inputRef.current?.focus(), 50); }
        setListening(false);
      };
      rec.start();
    } catch { setListening(false); }
  };

  const handleRefresh = () => {
    // New chat: clear the screen AND server memory (history + drafts).
    if (config.clearUrl) {
      fetch(config.clearUrl, { method: "POST" }).catch(() => {});
    }
    setMsgs([]); setConfirmed(new Set());
  };

  return (
    <>
      {/* Backdrop with blur fade — slides/fades on close */}
      {visible && (
        <div className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-sm ${exiting ? "animate-fade-out" : "animate-fade-in"}`} onClick={onClose} />
      )}

      {/* Floating chat window — slide-down on outside click */}
      {visible && (
        <div
          className={`fixed z-50 left-1/2 -translate-x-1/2 bottom-[84px] w-[min(560px,calc(100vw-24px))] h-[min(560px,calc(100vh-140px))] bg-[var(--bg-card)]/95 backdrop-blur-xl border border-white/[0.08] rounded-[20px] shadow-[0_20px_60px_rgba(0,0,0,0.5),0_1px_3px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.04)] flex flex-col overflow-hidden ${exiting ? "animate-scale-down" : "animate-scale-up"}`}
          role="dialog"
          aria-label={config.title}
          style={{ fontFamily: "'Geist', 'Outfit', Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" }}
        >
          {/* subtle top gradient line */}
          <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-violet-500/20 to-transparent" />
          {/* Header with hover-rotate */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent">
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-sm shadow-violet-600/20">
                <span className="text-[10px] font-extrabold text-white tracking-wider">AI</span>
              </div>
              <div>
                <p className="text-[15px] font-bold text-[var(--text-primary)] tracking-tight leading-none">{config.title}</p>
                <p className="text-[11px] text-[var(--text-tertiary)] font-medium">{config.subtitle}</p>
              </div>
              <span className="ml-2 h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse" />
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              aria-label="New chat"
              title="New chat"
              className="group p-2 rounded-full hover:bg-white/[0.06] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer border-0 bg-transparent transition-all duration-300 hover:scale-110 active:scale-95"
            >
              <svg className="w-[16px] h-[16px] transition-transform duration-500 group-hover:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>

          {/* Mode tabs — shown once the popup is open */}
          {modes && modes.length > 1 && (
            <div className="flex gap-1 px-5 pt-3">
              {modes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { if (m.id !== mode) onModeChange?.(m.id); }}
                  className={`flex-1 px-3 py-1.5 text-[12px] font-bold rounded-full border-0 cursor-pointer transition-all duration-200 ${m.id === mode
                    ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-[0_2px_10px_rgba(124,58,237,0.35)]"
                    : "bg-white/[0.04] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-white/[0.08]"}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {/* Messages with staggered entrance */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-5 bg-transparent scrollbar-thin scroll-smooth">
            {msgs.length === 0 && !busy ? (
              <div className="space-y-4 py-2 animate-fade-in">
                <p className="text-[15px] font-medium leading-relaxed text-[var(--text-secondary)]">{config.emptyText}</p>
                <div className="flex flex-wrap gap-2">
                  {config.suggestions.map((s, i) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      style={{ animationDelay: `${i * 60}ms` }}
                      className="animate-chat-in px-4 py-2 text-[13px] font-medium rounded-full border border-white/[0.08] bg-white/[0.03] text-[var(--text-secondary)] hover:bg-white/[0.08] hover:border-violet-500/30 hover:text-[var(--text-primary)] hover:shadow-[0_4px_12px_rgba(124,58,237,0.15)] hover:scale-[1.02] active:scale-[0.98] cursor-pointer text-left transition-all duration-300"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {msgs.map((m, mi) => (
                  <div
                    key={mi}
                    className={m.role === "user" ? "animate-chat-in-right" : "animate-chat-in"}
                    style={{ animationDelay: `${Math.min(mi * 40, 200)}ms` }}
                  >
                    {m.role === "user" ? (
                      <div className="flex justify-end group">
                        <div className="flex items-start gap-2.5 max-w-[85%]">
                          <div className="rounded-2xl rounded-br-md bg-gradient-to-br from-[#3b82f6] to-[#2563eb] text-white px-4 py-3.5 text-[16px] leading-relaxed whitespace-pre-wrap font-medium shadow-[0_4px_16px_rgba(59,130,246,0.25)] group-hover:shadow-[0_6px_20px_rgba(59,130,246,0.3)] group-hover:scale-[1.01] transition-all duration-300">
                            {m.text}
                          </div>
                          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#3b82f6] to-[#1d4ed8] flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0 mt-0.5 shadow-md ring-2 ring-white/10 group-hover:ring-white/20 group-hover:scale-105 transition-all duration-300">{String(userInitial).charAt(0).toUpperCase()}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2.5 items-start group">
                        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white text-[11px] font-extrabold flex-shrink-0 mt-1 shadow-md shadow-violet-600/20 ring-1 ring-white/10 group-hover:shadow-violet-600/30 group-hover:scale-105 transition-all duration-300">AI</div>
                        <div className="flex-1 space-y-1.5 min-w-0">
                          {m.activity && m.activity.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {m.activity.map((a, ai) => (
                                <span key={ai} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)] border border-white/[0.06] shadow-sm hover:border-violet-500/20 hover:bg-white/[0.05] transition-all duration-300">
                                  <span className="transition-transform duration-300 group-hover:scale-110">{config.toolIcons[a.tool] ?? "⚙️"}</span>{a.label}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="bg-[var(--bg-input)]/90 backdrop-blur-sm border border-white/[0.06] rounded-2xl rounded-tl-md px-4 py-3.5 text-[16px] leading-[1.7] text-[var(--text-primary)] font-[450] shadow-sm hover:shadow-md hover:border-white/[0.08] hover:bg-[var(--bg-input)] transition-all duration-300 chat-markdown">
                            <Markdown text={m.text} className="md-text !text-[16px] !leading-[1.7]" />
                          </div>
                          <div className="flex items-center gap-2 text-[12px] text-[var(--text-tertiary)] px-1 font-medium">
                            <span>Just now</span>
                          </div>
                          {config.executeUrl && m.proposals && m.proposals.length > 0 && (
                            <div className="space-y-2">
                              {m.proposals.map((p, pi) => {
                                const key = mi * 100 + pi;
                                const done = confirmed.has(key);
                                return (
                                  <div key={pi} className="rounded-xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/[0.07] to-violet-500/[0.07] backdrop-blur-sm px-4 py-3 hover:border-indigo-500/30 hover:shadow-[0_4px_16px_rgba(99,102,241,0.12)] hover:scale-[1.01] transition-all duration-300">
                                    <p className="font-bold text-[13px] text-indigo-300">{p.label}</p>
                                    {(p.text || p.spec) && <p className="mt-1.5 text-[13px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{p.text || p.spec}</p>}
                                    <button type="button" disabled={done} onClick={() => void confirm(mi, pi, p)} className="mt-3 px-4 py-2 text-[13px] font-bold rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-500 hover:to-violet-500 hover:shadow-[0_4px_12px_rgba(99,102,241,0.4)] hover:scale-105 active:scale-95 disabled:opacity-50 cursor-pointer border-0 transition-all duration-300">
                                      {done ? "✓ Applied" : "Confirm & apply →"}
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
                  <div className="flex gap-2.5 items-center animate-fade-in">
                    <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white text-[11px] font-extrabold flex-shrink-0 shadow-sm">AI</div>
                    <div className="bg-[var(--bg-input)]/80 border border-white/[0.06] rounded-2xl rounded-tl-md px-4 py-3 flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-[var(--text-tertiary)] animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1.4s" }} />
                      <span className="h-2 w-2 rounded-full bg-[var(--text-tertiary)] animate-bounce" style={{ animationDelay: "150ms", animationDuration: "1.4s" }} />
                      <span className="h-2 w-2 rounded-full bg-[var(--text-tertiary)] animate-bounce" style={{ animationDelay: "300ms", animationDuration: "1.4s" }} />
                      <span className="ml-2 text-[13px] text-[var(--text-tertiary)] font-medium">Thinking…</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Bottom pill — glass, hover lift, focus glow (skipped when caller owns the launcher) */}
      {chrome === "full" && (
      <div className="fixed z-50 left-1/2 -translate-x-1/2 bottom-4 w-[min(560px,calc(100vw-24px))] animate-fade-in">
        <div
          className="group flex items-center gap-2 bg-[var(--bg-card)]/90 backdrop-blur-xl border border-white/[0.08] rounded-full px-2 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.35),0_1px_3px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.04)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.45),0_1px_3px_rgba(0,0,0,0.2)] hover:border-white/[0.12] hover:scale-[1.01] focus-within:border-violet-500/30 focus-within:shadow-[0_0_0_4px_rgba(124,58,237,0.15),0_8px_32px_rgba(0,0,0,0.35)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
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
            className="flex-1 bg-transparent outline-none text-[16px] font-medium placeholder:text-[var(--text-tertiary)] text-[var(--text-primary)] px-3 py-1"
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleMic(); }}
            aria-label={listening ? "Stop listening" : "Voice input"}
            className={`p-2.5 rounded-full cursor-pointer border-0 flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-90 ${listening ? "bg-red-500 text-white shadow-[0_0_16px_rgba(239,68,68,0.5)] animate-pulse" : "hover:bg-white/[0.06] text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-transparent"}`}
            title={listening ? "Listening…" : "Voice input"}
          >
            <svg className={`w-[16px] h-[16px] transition-transform duration-300 ${listening ? "scale-110" : "group-hover:scale-105"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 10a7 7 0 01-14 0M12 18v3M8 21h8" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void send(input); }}
            disabled={!input.trim() || busy}
            aria-label="Send"
            className="h-9 w-9 rounded-full bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-[#2a2a2e] dark:to-[#1f1f23] border border-black/10 dark:border-white/10 flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:from-white hover:to-zinc-100 dark:hover:from-[#3a3a3e] dark:hover:to-[#2a2a2e] hover:shadow-md hover:scale-110 active:scale-90 disabled:opacity-40 disabled:hover:scale-100 disabled:hover:shadow-none cursor-pointer transition-all duration-300"
          >
            <svg className="w-[14px] h-[14px] transition-transform duration-300 group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h12M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
      )}
    </>
  );
}
