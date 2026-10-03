"use client";

import React, { useState, useRef, useEffect } from "react";
import Markdown from "./Markdown";
import SpecForm, { type SpecQuestion } from "./SpecForm";

interface ChatProposal {
  kind: "comment" | "spec_fix" | "price_quote" | "spec_form" | "price_table";
  text?: string;
  scope?: string;
  itemIndex?: number;
  spec?: string;
  label: string;
  productId?: string;
  productName?: string;
  markedPrice?: number;
  unit?: string;
  confidence?: number;
  quoteAgeDays?: number | null;
  moq?: string | null;
  deliveryDays?: number | null;
  questions?: { key: string; label: string; note?: string; required?: boolean; type?: "options" | "multiselect" | "text" | "number" | "date"; options?: string[] }[];
  rows?: { variation: string; markedPrice: number; unit: string; confidence: number; quoteAgeDays?: number | null; moq?: string | null; deliveryDays?: number | null; best?: boolean; itemIndex?: number; itemName?: string }[];
}
interface ChatActivity { tool: string; label: string; }
interface ChatMsg { role: "user" | "assistant"; text: string; proposals?: ChatProposal[]; activity?: ChatActivity[]; }

const SUGGESTIONS = ["What's missing on this enquiry?", "Get AI price for an item", "Draft a note for the enquiry thread", "Help me fix an item spec"];
const TOOL_ICON: Record<string, string> = {
  get_enquiry_summary: "📋",
  propose_comment: "✍️",
  propose_spec_fix: "🛠️",
  find_price: "🔍",
  ask_specs: "📝",
  quote_price: "💰",
  web_search: "🌐",
  fetch_page: "📄",
  calculate: "🧮",
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

  useEffect(() => { setMsgs([]); setConfirmed(new Set()); }, [enquiryId]);
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
    // Assistant placeholder goes up INSTANTLY (before any network), so the
    // thinking chip is visible through the whole dead window: connect +
    // worker boot + model queue, not just after the first token.
    setMsgs((p) => [...p, { role: "user", text: q }, { role: "assistant", text: "", activity: [], proposals: [] }]);
    setInput("");
    const tryStream = async (): Promise<boolean> => {
      try {
        const ctrl = new AbortController();
        // 60s budget: the primary may be throttled and the turn can fail over
        // to a reasoning-model fallback running a multi-step tools loop.
        const t = setTimeout(() => ctrl.abort(), 60000);
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
        // Placeholder was already appended in send() — don't add a second one.
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
                  accActivity = [...accActivity, evt.data as ChatActivity];
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
                  // Keep the live-streamed text — replacing it with the final
                  // reply is what made streamed output vanish mid-turn.
                  if (!accText) accText = String(evt.data.reply ?? "");
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
    // Server-side wipe (history + price session) — fire-and-forget is fine:
    // the route awaits the KV deletes before responding.
    void fetch(`/api/enquiries/${enquiryId}/chat/clear`, { method: "POST" }).catch(() => {});
    setMsgs([]);
    setConfirmed(new Set());
    setThinking("");
  };

  // Thinking status shows only while the answer hasn't started streaming —
  // once text arrives the bubble itself is the progress. This keeps the
  // indicator from sticking around under a half-written answer.
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
          aria-label="AI Agent"
          style={{ fontFamily: "'Geist', 'Outfit', Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07] bg-[var(--bg-card)]">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-violet-600 flex items-center justify-center shadow-sm flex-shrink-0">
                <span className="text-[10px] font-extrabold text-white tracking-wider">AI</span>
              </div>
              <div>
                <p className="text-[14px] font-bold text-[var(--text-primary)] tracking-tight leading-tight">AI Agent</p>
                <p className="text-[11px] text-[var(--text-tertiary)] font-medium leading-tight">Enquiry copilot</p>
              </div>
              <span className="ml-2 h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse" />
            </div>
            <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleRefresh}
              aria-label="Refresh"
              title="Clear chat"
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

          {/* Messages with staggered entrance */}
          <div ref={scrollRef} className="relative flex-1 overflow-y-auto px-5 py-5 space-y-5 bg-transparent scrollbar-thin scroll-smooth">
            {msgs.length === 0 && !busy ? (
              <div className="space-y-4 py-2 animate-fade-in">
                <p className="text-[15px] font-medium leading-relaxed text-[var(--text-secondary)]">How can I help with this enquiry?</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s, i) => (
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
                          <div className="rounded-2xl rounded-br-md bg-blue-600 text-white px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap font-medium shadow-sm">
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
                                  <span>{TOOL_ICON[a.tool] ?? "⚙️"}</span>{a.label}
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
                              {m.proposals.map((p, pi) => {
                                const key = mi * 100 + pi;
                                const done = confirmed.has(key);
                                if (p.kind === "price_table" && Array.isArray(p.rows) && p.rows.length > 0) {
                                  const batched = p.rows.some((r) => r.itemIndex != null);
                                  const applyRow = (r: NonNullable<ChatProposal["rows"]>[number], ri: number) => {
                                    if (r.itemIndex == null) return;
                                    void confirm(mi, 900 + ri, {
                                      kind: "price_quote",
                                      itemIndex: r.itemIndex - 1,
                                      markedPrice: r.markedPrice,
                                      unit: r.unit,
                                      productName: p.productName,
                                      productId: p.productId,
                                      confidence: r.confidence,
                                      quoteAgeDays: r.quoteAgeDays ?? null,
                                      moq: r.moq ?? null,
                                      deliveryDays: r.deliveryDays ?? null,
                                      label: `Apply AI price · Item ${r.itemIndex}`,
                                    } as ChatProposal);
                                  };
                                  const groups = batched
                                    ? (() => {
                                        const order: number[] = [];
                                        const map = new Map<number, { name?: string; rows: { r: NonNullable<ChatProposal["rows"]>[number]; ri: number }[] }>();
                                        p.rows.forEach((r, ri) => {
                                          const k = Number(r.itemIndex ?? 0);
                                          if (!map.has(k)) { map.set(k, { name: r.itemName, rows: [] }); order.push(k); }
                                          map.get(k)!.rows.push({ r, ri });
                                        });
                                        return order.map((k) => ({ itemIndex: k, ...map.get(k)! }));
                                      })()
                                    : [{ itemIndex: 0, name: undefined, rows: p.rows.map((r, ri) => ({ r, ri })) }];
                                  return (
                                    <div key={pi} className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                                      <p className="px-4 pt-3 pb-2 font-bold text-[13px] text-[var(--text-primary)]">{p.label}</p>
                                      {groups.map((g) => (
                                        <div key={g.itemIndex}>
                                          {batched && (
                                            <p className="px-4 pt-2 text-[12px] font-extrabold text-indigo-300">
                                              Item {g.itemIndex}{g.name ? <span className="font-bold text-[var(--text-secondary)]"> — {g.name}</span> : null}
                                            </p>
                                          )}
                                          <table className="w-full text-[12px] leading-snug">
                                            <thead>
                                              <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] border-y border-white/[0.06]">
                                                <th className="px-4 py-1.5 font-bold">Variation</th>
                                                <th className="px-2 py-1.5 font-bold text-right">Price</th>
                                                <th className="px-2 py-1.5 font-bold text-right">Match</th>
                                                <th className="px-2 py-1.5 font-bold text-right">Age</th>
                                                {batched && <th className="px-4 py-1.5 font-bold text-right">Apply</th>}
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {g.rows.map(({ r, ri }) => {
                                                const doneKey = mi * 100 + 900 + ri;
                                                const done = confirmed.has(doneKey);
                                                return (
                                                  <tr key={ri} className={`border-b border-white/[0.04] last:border-0 ${r.best ? "bg-emerald-500/[0.07]" : ""}`}>
                                                    <td className="px-4 py-2 text-[var(--text-secondary)]">
                                                      {r.best && <span className="mr-1.5 inline-block text-[10px] font-extrabold px-1.5 py-px rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 align-middle">BEST</span>}
                                                      {r.variation}
                                                      {(r.moq || r.deliveryDays != null) && (
                                                        <span className="block text-[11px] text-[var(--text-tertiary)]">
                                                          {[r.moq ? `MOQ ${r.moq}` : null, r.deliveryDays != null ? `${r.deliveryDays}d delivery` : null].filter(Boolean).join(" · ")}
                                                        </span>
                                                      )}
                                                    </td>
                                                    <td className="px-2 py-2 text-right font-extrabold text-white whitespace-nowrap">
                                                      ₹{Number(r.markedPrice).toLocaleString("en-IN")}{r.unit ? <span className="font-bold text-[var(--text-tertiary)]">/{r.unit}</span> : null}
                                                    </td>
                                                    <td className="px-2 py-2 text-right font-bold text-[var(--text-secondary)] whitespace-nowrap">{(Number(r.confidence) * 100).toFixed(0)}%</td>
                                                    <td className="px-2 py-2 text-right text-[var(--text-tertiary)] whitespace-nowrap">{r.quoteAgeDays != null ? `${r.quoteAgeDays}d` : "—"}</td>
                                                    {batched && (
                                                      <td className="px-4 py-2 text-right whitespace-nowrap">
                                                        <button
                                                          type="button"
                                                          disabled={done}
                                                          onClick={() => applyRow(r, ri)}
                                                          className="px-3 py-1 text-[11px] font-extrabold rounded-full bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 cursor-pointer border-0 transition-colors duration-200"
                                                        >
                                                          {done ? "✓" : "Apply →"}
                                                        </button>
                                                      </td>
                                                    )}
                                                  </tr>
                                                );
                                              })}
                                            </tbody>
                                          </table>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                }
                                if (p.kind === "spec_form" && Array.isArray(p.questions) && p.questions.length > 0) {
                                  const qs: SpecQuestion[] = p.questions.map((q) => ({
                                    key: q.key,
                                    label: q.label,
                                    type: q.type === "options" || q.type === "multiselect" || q.type === "number" || q.type === "date" ? q.type : "text",
                                    options: Array.isArray(q.options) ? q.options : [],
                                    hint: q.note,
                                    required: q.required !== false,
                                    section: "spec",
                                  }));
                                  return (
                                    <SpecForm
                                      key={pi}
                                      title={p.productName ?? p.label}
                                      questions={qs}
                                      onSubmit={(text) => void send(text)}
                                    />
                                  );
                                }
                                return (
                                  <div key={pi} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                                    <p className="font-bold text-[13px] text-[var(--text-primary)]">{p.label}</p>
                                    {p.kind === "price_quote" && typeof p.markedPrice === "number" && (
                                      <p className="mt-1 text-[22px] font-extrabold text-white tracking-tight">
                                        ₹{p.markedPrice.toLocaleString("en-IN")}{p.unit ? <span className="text-[13px] font-bold text-[var(--text-secondary)]">/{p.unit}</span> : null}
                                        {typeof p.confidence === "number" && (
                                          <span className="ml-2 align-middle text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                            {(p.confidence * 100).toFixed(0)}% match
                                          </span>
                                        )}
                                      </p>
                                    )}
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
                      <span className="ml-2 text-[13px] font-medium text-[var(--text-secondary)] truncate">{thinking || (thinkSecs > 2 ? `Thinking… ${thinkSecs}s` : "Thinking…")}</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Bottom pill — glass, hover lift, focus glow */}
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
    </>
  );
}
