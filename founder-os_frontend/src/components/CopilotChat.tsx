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

interface CopilotActivity { tool: string; label: string; pending?: boolean; }
interface CopilotMsg { role: "user" | "assistant"; text: string; proposals?: CopilotProposal[]; activity?: CopilotActivity[]; thinking?: string; }

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
  /** Per-request abort budget ms (default 60000). 0 or negative = no timer. */
  timeoutMs?: number;
  /** Extra body fields sent with every message (e.g. { batchId } for bulk). */
  context?: Record<string, string>;
}

export default function CopilotChat({ config, open, onClose, onOpen, chrome = "full", modes, mode, onModeChange, headerExtra }: {
  config: CopilotConfig;
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  /** "full" = popup + bottom pill; "popup" = popup only (caller renders its own launcher). */
  chrome?: "full" | "popup";
  /** Mode tabs shown inside the popup header (e.g. Knowledge | Add Rates). */
  modes?: { id: string; label: string }[];
  /** Rendered inside the popup below the mode tabs (e.g. bulk batch picker). */
  headerExtra?: React.ReactNode;
  mode?: string;
  onModeChange?: (id: string) => void;
}) {
  const userInitial = config.userInitial ?? "S";
  const [msgs, setMsgs] = useState<CopilotMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // User interrupt: the live request's controller + a flag separating
  // "I hit stop" from real timeouts (different message, no fallback run).
  const abortRef = useRef<AbortController | null>(null);
  const userStoppedRef = useRef(false);
  const stop = () => {
    userStoppedRef.current = true;
    try { abortRef.current?.abort(); } catch {}
  };
  const [thinking, setThinking] = useState("");
  const [thinkSecs, setThinkSecs] = useState(0);
  // Liveness clock: ticks while a turn is in flight so even a long silent
  // wait (cold worker, model queue) shows elapsed time, not a dead screen.
  useEffect(() => {
    if (!busy) { setThinkSecs(0); return; }
    const started = Date.now();
    const id = setInterval(() => setThinkSecs(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(id);
  }, [busy]);
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [listening, setListening] = useState(false);
  const [visible, setVisible] = useState(open);
  const [exiting, setExiting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recogRef = useRef<any>(null);

  useEffect(() => { setMsgs([]); setConfirmed(new Set()); }, [config.resetKey]);

  // Conversation id, VOLATILE per mount (founder order): a refresh or a
  // remount mints a FRESH id → fresh server thread (history + trace +
  // draft are keyed under it). Closing/reopening the panel (✕, backdrop)
  // only hides it — no remount, so the thread survives. ONLY the ↻ button
  // mints a new id mid-mount (a deliberate new chat). Sent with every
  // message. Nothing is persisted — a reload always starts a new chat.
  const mintSession = () => {
    let s = "";
    try { s = (crypto as any)?.randomUUID?.() ?? ""; } catch {}
    if (!s) s = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return s;
  };
  const sessionRef = useRef<string>("");
  if (!sessionRef.current) sessionRef.current = mintSession();
  const rotateSession = () => {
    sessionRef.current = mintSession();
    setMsgs([]); setConfirmed(new Set()); setThinking("");
  };
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

  /** Edge pages are HTML, never chat text: if any error body looks like
   *  markup (Cloudflare guillotine, proxy death), say so plainly instead
   *  of dumping `<!DOCTYPE…` into the thread. State was already saved
   *  server-side per step, so "continue" resumes. */
  const cleanErr = (m: string): string => {
    const t = String(m ?? "");
    if (t.includes("<!DOCTYPE") || t.trimStart().startsWith("<html") || /HTTP \d+ </.test(t)) {
      return "Server hiccup mid-turn (edge error page) — work so far is saved. Say continue to resume.";
    }
    return t;
  };

  // Transport chaining (see engine turnBudgetMs): one user message may take
  // several HTTP hops; hop 0 shows the user bubble, later hops silently add
  // fresh assistant bubbles on the same thread. busy stays true across hops
  // and drops only when the chain truly ends — no interleaved sends.
  const send = async (text: string, hop = 0): Promise<void> => {
    const q = text.trim();
    if (!q) return;
    if (hop === 0) {
      if (busy) return;
      userStoppedRef.current = false;
      if (!open) onOpen();
      setBusy(true);
      setThinking("");
      // Assistant placeholder goes up INSTANTLY (before any network), so the
      // thinking chip is visible through the whole dead window: connect +
      // worker boot + model queue, not just after the first token.
      setMsgs((p) => [...p, { role: "user", text: q }, { role: "assistant", text: "", activity: [], proposals: [] }]);
      setInput("");
    } else {
      setMsgs((p) => [...p, { role: "assistant", text: "", activity: [], proposals: [] }]);
    }
    const chainNext = async (): Promise<void> => {
      if (userStoppedRef.current || hop >= 9) {
        if (!userStoppedRef.current) {
          setMsgs((p) => [...p, { role: "assistant", text: "Paused after a long run — say continue to resume.", proposals: [], activity: [] }]);
        }
        setBusy(false);
        return;
      }
      return send("continue", hop + 1);
    };
    const tryStream = async (): Promise<"done" | "continued" | "failed"> => {
      try {
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        // Abort budget (default 60s). timeoutMs 0 (or negative) = NO timer —
        // the request lives until the server answers or the user navigates.
        const streamBudget = config.timeoutMs ?? 60000;
        const t = streamBudget > 0 ? setTimeout(() => ctrl.abort(), streamBudget) : undefined;
        const res = await fetch(config.streamUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ message: q, session: sessionRef.current, ...(config.context ?? {}) }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const raw = await res.text().catch(() => "");
          // Edge guillotine answers with an HTML page (status 524 etc.) —
          // surface it cleanly; the turn's state was saved per step.
          const errText = cleanErr(raw).slice(0, 200) || `HTTP ${res.status}`;
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
        let accThink = "";
        let accActivity: CopilotActivity[] = [];
        let accProposals: CopilotProposal[] = [];
        let sawDone = false;
        let streamContinued = false;
        // Placeholder was already appended in send() — don't add a second one.
        // Reader cap follows the same budget (0/negative = no cap).
        const readBudget = config.timeoutMs ?? 60000;
        const timeout = readBudget > 0 ? setTimeout(() => { try { reader.cancel(); } catch {} }, readBudget) : undefined;
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
                } else if (evt.type === "activity-start" && evt.data) {
                  // Tool announced BEFORE it runs — pulsing chip until the
                  // completion event below replaces it. No more dead air
                  // during multi-second lookups.
                  const chip = { ...(evt.data as CopilotActivity), pending: true };
                  accActivity = [...accActivity, chip];
                  setMsgs((p) => {
                    const cp = [...p]; const last = cp[cp.length - 1];
                    if (last?.role === "assistant") last.activity = [...accActivity];
                    return [...cp];
                  });
                } else if (evt.type === "activity" && evt.data) {
                  // Completion settles the matching pending chip in place
                  // (first pending with the same tool); unmatched appends.
                  const done = { ...(evt.data as CopilotActivity), pending: false };
                  const idx = accActivity.findIndex((a) => a.tool === done.tool && a.pending);
                  accActivity = idx >= 0
                    ? [...accActivity.slice(0, idx), done, ...accActivity.slice(idx + 1)]
                    : [...accActivity, done];
                  setMsgs((p) => {
                    const cp = [...p]; const last = cp[cp.length - 1];
                    if (last?.role === "assistant") last.activity = [...accActivity];
                    return [...cp];
                  });
                } else if (evt.type === "thinking" && typeof evt.data?.text === "string") {
                  const t = String(evt.data.text);
                  if (t) {
                    // Accumulate the full reasoning stream onto the message
                    // (minimized dropdown below); the chip keeps only the tail.
                    accThink = (accThink + t).slice(-6000);
                    setThinking(accThink.slice(-140).trim());
                    const frozen = accThink;
                    setMsgs((p) => {
                      const cp = [...p]; const last = cp[cp.length - 1];
                      if (last?.role === "assistant") last.thinking = frozen;
                      return [...cp];
                    });
                  }
                } else if (evt.type === "done" && evt.data) {
                  setThinking("");
                  // Keep the live-streamed text — replacing it with the final
                  // reply is what made streamed output vanish mid-turn.
                  if (!accText) accText = String(evt.data.reply ?? "");
                  accActivity = Array.isArray(evt.data.activity) ? evt.data.activity : accActivity;
                  accProposals = Array.isArray(evt.data.proposals) ? evt.data.proposals : [];
                  if ((evt.data as any)?.continued) streamContinued = true;
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
          if (abortRef.current === ctrl) abortRef.current = null;
          try { reader.releaseLock(); } catch {}
        }
        if (!accText && accProposals.length === 0 && accActivity.length === 0) throw new Error("empty stream");
        return streamContinued ? "continued" : "done";
      } catch {
        // KEEP the placeholder: the non-streaming fallback below fills it in
        // place, and the thinking indicator stays live while it runs.
        // (Deleting it here opened a dead-silent gap — no bubble, no
        // thinking — while the fallback worked for minutes.)
        return "failed";
      }
    };
    const s = await tryStream();
    if (s === "done") { setBusy(false); return; }
    // Turn yielded for transport (server saved state): follow silently on
    // the same session — the user sees one continuous working thread.
    if (s === "continued") return chainNext();
    // User hit stop mid-stream: do NOT run the fallback — the partial
    // bubble stays as-is (server kept per-step state; "continue" resumes).
    if (userStoppedRef.current) {
      setMsgs((p) => {
        const cp = [...p]; const last = cp[cp.length - 1];
        if (last?.role === "assistant" && !last.text && (last.proposals?.length ?? 0) === 0 && (last.activity?.length ?? 0) === 0) {
          last.text = "Stopped — nothing had arrived yet. Send anything to resume.";
        }
        return [...cp];
      });
      setBusy(false); return;
    }
    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const chatBudget = config.timeoutMs ?? 60000;
      const t = chatBudget > 0 ? setTimeout(() => ctrl.abort(), chatBudget) : undefined;
      const res = await fetch(config.chatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, session: sessionRef.current, ...(config.context ?? {}) }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (abortRef.current === ctrl) abortRef.current = null;
      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        const errText = cleanErr(raw) || `HTTP ${res.status}`;
        if (res.status === 429) throw new Error("Rate-limited — please wait a minute and retry.");
        throw new Error(errText);
      }
      const data = await res.json();
      // Fill the waiting placeholder in place (kept alive above) — append
      // only if it somehow went missing, so replies never duplicate.
      const fill = (text: string, proposals: any[] = [], activity: any[] = []) => {
        setMsgs((p) => {
          const cp = [...p]; const last = cp[cp.length - 1];
          if (last?.role === "assistant" && !last.text && (last.proposals?.length ?? 0) === 0) {
            cp[cp.length - 1] = { ...last, text, proposals, activity };
            return [...cp];
          }
          return [...p, { role: "assistant", text, proposals, activity }];
        });
      };
      fill(
        String(data.reply || data.error || "No answer."),
        Array.isArray(data.proposals) ? data.proposals : [],
        Array.isArray(data.activity) ? data.activity : [],
      );
      // Fallback hop also yields for transport: chain it the same way.
      if ((data as any)?.continued && !userStoppedRef.current) return chainNext();
    } catch (e: any) {
      abortRef.current = null;
      // A user stop is not an error: partial work stays in the bubble and
      // the server kept per-step state, so "continue" resumes the turn.
      const msg = cleanErr(userStoppedRef.current
        ? "Stopped — partial work is kept. Say continue to resume."
        : e?.name === "AbortError" ? "Chat timed out — please retry." : String(e?.message || "Chat failed — please retry.").slice(0, 200));
      setMsgs((p) => {
        const cp = [...p]; const last = cp[cp.length - 1];
        if (last?.role === "assistant" && !last.text && (last.proposals?.length ?? 0) === 0) {
          cp[cp.length - 1] = { ...last, text: msg };
          return [...cp];
        }
        return [...p, { role: "assistant", text: msg }];
      });
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
    // New chat = new conversation id. Server memory is keyed under the id,
    // so rotation alone guarantees freshness — no wipe request that can fail
    // and leave a secretly-alive thread behind. Old threads expire by TTL.
    rotateSession();
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
          {headerExtra && <div className="px-5 pt-3">{headerExtra}</div>}

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
                                <span key={ai} className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)] border border-white/[0.06]${a.pending ? " animate-pulse" : ""}`}>
                                  <span>{a.pending ? "⏳" : (config.toolIcons[a.tool] ?? "⚙️")}</span>{a.label}
                                </span>
                              ))}
                            </div>
                          )}
                          {m.thinking && (
                            <details className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-1.5">
                              <summary className="cursor-pointer text-[12px] font-bold text-[var(--text-tertiary)] select-none">Thinking</summary>
                              <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap max-h-48 overflow-y-auto">{m.thinking}</p>
                            </details>
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
                                    {Array.isArray((p as any)?.table?.rows) && (p as any).table.rows.length > 0 && (
                                      <div className="mt-2 overflow-x-auto rounded-lg border border-white/10">
                                        <table className="w-full text-[12px]">
                                          <thead>
                                            <tr>
                                              {((p as any).table.columns ?? Object.keys((p as any).table.rows[0] ?? {})).map((c: string) => (
                                                <th key={c} className="px-2 py-1.5 text-left font-extrabold text-[var(--text-tertiary)] border-b border-white/10 whitespace-nowrap">{c}</th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {(p as any).table.rows.slice(0, 20).map((r: Record<string, string>, ri: number) => (
                                              <tr key={ri} className="border-b border-white/[0.04] last:border-0">
                                                {((p as any).table.columns ?? Object.keys(r)).map((c: string) => (
                                                  <td key={c} className="px-2 py-1.5 text-[var(--text-secondary)] align-top">{String(r?.[c] ?? "—")}</td>
                                                ))}
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
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
                      <span className="ml-2 text-[13px] font-medium text-[var(--text-secondary)] truncate">{thinking || (thinkSecs > 2 ? `Thinking… ${thinkSecs}s` : "Thinking…")}</span>
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
          {busy ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); stop(); }}
              aria-label="Stop"
              title="Stop the agent"
              className="h-9 w-9 rounded-full border-0 flex items-center justify-center cursor-pointer transition-colors duration-200 bg-red-500/90 text-white hover:bg-red-500"
            >
              <svg className="w-[13px] h-[13px]" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void send(input); }}
              disabled={!input.trim()}
              aria-label="Send"
              className={`h-9 w-9 rounded-full border-0 flex items-center justify-center cursor-pointer transition-colors duration-200 disabled:opacity-40 ${input.trim() ? "bg-violet-600 text-white hover:bg-violet-500" : "bg-white/[0.06] text-[var(--text-tertiary)]"}`}
            >
              <svg className="w-[14px] h-[14px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h12M12 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
      )}
    </>
  );
}
