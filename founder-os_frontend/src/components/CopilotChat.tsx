"use client";

// CopilotChat — reusable AI-copilot interface (same look/behavior everywhere).
//
// One component, many departments: the caller passes a CopilotConfig (titles,
// suggestions, tool icons, endpoint URLs). Sales keeps its own ChatbaseCopilot
// untouched; new departments (product line, ...) mount this with their config.
// Backend mirror: founder-os_backend/src/copilot/registry.ts
import React, { useState, useRef, useEffect } from "react";
import Markdown from "./Markdown";
import SpecForm, { type SpecQuestion } from "./SpecForm";

export interface CopilotProposal {
  kind: string;
  label: string;
  text?: string;
  spec?: string;
  /** spec_form only: rendered questionnaire (see SpecForm). */
  title?: string;
  questions?: SpecQuestion[];
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
  const [thinking, setThinking] = useState("");
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
    setThinking("");
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
                } else if (evt.type === "thinking" && typeof evt.data?.text === "string") {
                  const t = String(evt.data.text).trim().slice(-140);
                  if (t) setThinking(t);
                } else if (evt.type === "done" && evt.data) {
                  setThinking("");
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
    setThinking("");
  };

  // Thinking status shows only while the answer hasn't started streaming —
  // once text arrives the bubble itself is the progress.
  const lastMsg = msgs[msgs.length - 1];
  const showThinking = busy && (!lastMsg || (lastMsg.role === "assistant" && !lastMsg.text));

  return (
    <>
      {/* Backdrop with blur fade — slides/fades on close */}
      {visible && (
        <div className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-sm ${exiting ? "animate-fade-out" : "animate-fade-in"}`} onClick={onClose} />
      )}

      {/* Floating chat window — slide-down on outside click */}
      {visible && (
        <div
          className={`fixed z-50 left-1/2 -translate-x-1/2 bottom-[84px] w-[clamp(340px,94vw,600px)] md:w-[clamp(520px,62vw,780px)] xl:w-[clamp(640px,48vw,920px)] h-[clamp(440px,74dvh,620px)] md:h-[clamp(520px,78dvh,800px)] xl:h-[clamp(560px,82dvh,920px)] rounded-2xl bg-[var(--bg-card)] border border-white/10 shadow-[0_24px_64px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden ${exiting ? "animate-scale-down" : "animate-scale-up"}`}
          role="dialog"
          aria-label={config.title}
          style={{ fontFamily: "'Geist', 'Outfit', Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07] bg-[var(--bg-card)]">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-violet-600 flex items-center justify-center shadow-sm flex-shrink-0">
                <span className="text-[10px] font-extrabold text-white tracking-wider">AI</span>
              </div>
              <div>
                <p className="text-[14px] font-bold text-[var(--text-primary)] tracking-tight leading-tight">{config.title}</p>
                <p className="text-[11px] text-[var(--text-tertiary)] font-medium leading-tight">{config.subtitle}</p>
              </div>
              <span className="ml-2 h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse" />
            </div>
            <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleRefresh}
              aria-label="New chat"
              title="New chat"
              className="group p-2 rounded-full hover:bg-white/[0.06] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer border-0 bg-transparent transition-colors duration-200"
            >
              <svg className="w-[16px] h-[16px] transition-transform duration-500 group-hover:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              title="Close"
              className="p-2 rounded-full hover:bg-white/[0.06] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer border-0 bg-transparent transition-all duration-300 hover:rotate-90"
            >
              <svg className="w-[16px] h-[16px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            </div>
          </div>

          {/* Mode tabs — shown once the popup is open */}
          {modes && modes.length > 1 && (
                <div className="flex gap-1 px-5 pt-3">
                  {modes.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { if (m.id !== mode) onModeChange?.(m.id); }}
                      className={`flex-1 px-3 py-1.5 text-[12px] font-bold rounded-full border-0 cursor-pointer transition-colors duration-200 ${m.id === mode
                        ? "bg-violet-600 text-white"
                        : "bg-white/[0.04] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-white/[0.08]"}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
          )}

          {/* Messages with staggered entrance */}
          <div ref={scrollRef} className="relative flex-1 overflow-y-auto px-5 py-5 space-y-5 bg-transparent scrollbar-thin scroll-smooth">
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
                      className="animate-chat-in px-4 py-2 text-[13px] font-medium rounded-full border border-white/[0.08] bg-white/[0.03] text-[var(--text-secondary)] hover:bg-white/[0.08] hover:border-violet-500/30 hover:text-[var(--text-primary)] cursor-pointer text-left transition-colors duration-200"
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
                      <div className="flex justify-end">
                        <div className="flex items-start gap-2.5 max-w-[85%]">
                          <div className="rounded-2xl rounded-br-md bg-blue-600 text-white px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap font-medium">
                            {m.text}
                          </div>
                          <div className="h-8 w-8 rounded-full bg-blue-700 flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0 mt-0.5">{String(userInitial).charAt(0).toUpperCase()}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2.5 items-start">
                        <div className="h-8 w-8 rounded-full bg-violet-600 flex items-center justify-center text-white text-[11px] font-extrabold flex-shrink-0 mt-1">AI</div>
                        <div className="flex-1 space-y-1.5 min-w-0">
                          {m.activity && m.activity.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {m.activity.map((a, ai) => (
                                <span key={ai} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)] border border-white/[0.06]">
                                  <span>{config.toolIcons[a.tool] ?? "⚙️"}</span>{a.label}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="bg-[var(--bg-input)] border border-white/[0.06] rounded-2xl rounded-tl-md px-4 py-3 text-[15px] leading-[1.7] text-[var(--text-primary)] chat-markdown">
                            <Markdown text={m.text} className="md-text !text-[15px] !leading-[1.7]" />
                          </div>
                          <div className="flex items-center gap-2 text-[12px] text-[var(--text-tertiary)] px-1 font-medium">
                            <span>Just now</span>
                          </div>
                          {m.proposals && m.proposals.length > 0 && (
                            <div className="space-y-2">
                              {m.proposals.filter((p) => p.kind === "spec_form" && Array.isArray(p.questions) && p.questions.length > 0).map((p, pi) => (
                                <SpecForm key={`spec-${pi}`} title={p.title || p.label} questions={p.questions as SpecQuestion[]} onSubmit={(t) => void send(t)} />
                              ))}
                            </div>
                          )}
                          {config.executeUrl && m.proposals && m.proposals.length > 0 && (
                            <div className="space-y-2">
                              {m.proposals.map((p, pi) => {
                                const key = mi * 100 + pi;
                                const done = confirmed.has(key);
                                return (
                                  <div key={pi} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                                    <p className="font-bold text-[13px] text-[var(--text-primary)]">{p.label}</p>
                                    {(p.text || p.spec) && <p className="mt-1.5 text-[13px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{p.text || p.spec}</p>}
                                    <button type="button" disabled={done} onClick={() => void confirm(mi, pi, p)} className="mt-3 px-4 py-2 text-[13px] font-bold rounded-full bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 cursor-pointer border-0 transition-colors duration-200">
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
                {showThinking && (
                  <div className="flex gap-2.5 items-center animate-fade-in">
                    <div className="h-8 w-8 rounded-full bg-violet-600 flex items-center justify-center text-white text-[11px] font-extrabold flex-shrink-0">AI</div>
                    <div className="bg-[var(--bg-input)] border border-white/[0.06] rounded-2xl rounded-tl-md px-4 py-3 flex items-center gap-1.5 max-w-[85%]">
                      <span className="h-2 w-2 rounded-full bg-[var(--text-tertiary)] animate-bounce flex-shrink-0" style={{ animationDelay: "0ms", animationDuration: "1.4s" }} />
                      <span className="h-2 w-2 rounded-full bg-[var(--text-tertiary)] animate-bounce flex-shrink-0" style={{ animationDelay: "150ms", animationDuration: "1.4s" }} />
                      <span className="h-2 w-2 rounded-full bg-[var(--text-tertiary)] animate-bounce flex-shrink-0" style={{ animationDelay: "300ms", animationDuration: "1.4s" }} />
                      <span className="ml-2 text-[13px] font-medium text-[var(--text-secondary)] truncate">{thinking || "Thinking…"}</span>
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
      <div className="fixed z-50 left-1/2 -translate-x-1/2 bottom-4 w-[clamp(340px,94vw,600px)] md:w-[clamp(520px,62vw,780px)] xl:w-[clamp(640px,48vw,920px)] animate-fade-in">
        <div
          className="group flex items-center gap-2 bg-[var(--bg-card)] backdrop-blur-xl border border-white/[0.08] rounded-full px-2 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.35)] hover:border-white/[0.12] focus-within:border-violet-500/40 transition-colors duration-200"
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
            className={`p-2.5 rounded-full cursor-pointer border-0 flex items-center justify-center transition-colors duration-200 ${listening ? "bg-red-500 text-white" : "hover:bg-white/[0.06] text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-transparent"}`}
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
            className={`h-9 w-9 rounded-full border-0 flex items-center justify-center cursor-pointer transition-colors duration-200 disabled:opacity-40 ${input.trim() ? "bg-violet-600 text-white hover:bg-violet-500" : "bg-white/[0.06] text-[var(--text-tertiary)]"}`}
          >
            <svg className="w-[14px] h-[14px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h12M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
      )}
    </>
  );
}
