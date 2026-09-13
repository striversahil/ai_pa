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

interface ChatActivity {
  tool: string;
  label: string;
}

interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  proposals?: ChatProposal[];
  activity?: ChatActivity[];
}

const SUGGESTIONS = ["What's missing on this enquiry?", "Any past prices for these items?", "Summarize the discussion so far"];

const TOOL_ICON: Record<string, string> = {
  get_enquiry_summary: "📋",
  search_price_memory: "🔎",
  read_thread: "💬",
  propose_comment: "✍️",
  propose_spec_fix: "🛠️",
};

/** Per-enquiry copilot: markdown replies, tool chimes, confirm-to-apply cards.
 *  Two presentations sharing one backend thread (KV):
 *  - docked: inline right-rail panel (xl screens, always visible unless collapsed)
 *  - overlay: slide-over for smaller screens (open/onClose controlled by parent).
 *  Writes only happen via explicit Confirm taps. */
export default function EnquiryChat({ enquiryId, open, onClose, docked = false }: {
  enquiryId: string;
  open: boolean;
  onClose: () => void;
  docked?: boolean;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMsgs([]);
    setConfirmed(new Set());
  }, [enquiryId]);

  // Container-local autoscroll: never scrollIntoView (that yanks the whole
  // page when the docked rail updates).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy, open]);

  if (!open) return null;

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setMsgs((p) => [...p, { role: "user", text: q }]);
    setInput("");
    try {
      const res = await fetch(`/api/enquiries/${enquiryId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      });
      const data = await res.json();
      setMsgs((p) => [...p, {
        role: "assistant",
        text: String(data.reply || data.error || "No answer."),
        proposals: Array.isArray(data.proposals) ? data.proposals : [],
        activity: Array.isArray(data.activity) ? data.activity : [],
      }]);
    } catch {
      setMsgs((p) => [...p, { role: "assistant", text: "Chat failed — please retry." }]);
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

  const body = (
    <>
      <div ref={scrollRef} className={docked ? "flex-1 min-h-0 overflow-y-auto px-3 py-2.5 space-y-2" : "flex-1 overflow-y-auto px-4 py-3 space-y-2.5"}>
        {msgs.length === 0 && !busy && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--text-secondary)]">Ask about specs, missing details, past prices, or the thread — I’ll check the enquiry and show my work.</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="px-2.5 py-1 text-[11px] font-bold rounded-full border border-brand-indigo/40 text-brand-indigo hover:bg-brand-indigo/10 cursor-pointer bg-transparent text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, mi) => (
          <div key={mi}>
            {m.role === "user" ? (
              <div className="ml-8 rounded-2xl rounded-br-md bg-brand-indigo text-white px-3 py-1.5 text-xs leading-relaxed whitespace-pre-wrap">
                {m.text}
              </div>
            ) : (
              <div className="mr-1 space-y-1.5">
                {m.activity && m.activity.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {m.activity.map((a, ai) => (
                      <span
                        key={ai}
                        title={`Tool: ${a.tool}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)] border border-[var(--border-card)]"
                      >
                        <span>{TOOL_ICON[a.tool] ?? "⚙️"}</span>
                        {a.label}
                      </span>
                    ))}
                  </div>
                )}
                <div className="rounded-2xl rounded-bl-md bg-[var(--bg-input)]/60 border border-[var(--border-card)]/60 px-3 py-2 text-[var(--text-primary)]">
                  <Markdown text={m.text} />
                </div>
                {m.proposals && m.proposals.length > 0 && (
                  <div className="space-y-1.5">
                    {m.proposals.map((p, pi) => {
                      const key = mi * 100 + pi;
                      const done = confirmed.has(key);
                      return (
                        <div key={pi} className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 px-2.5 py-2">
                          <p className="font-bold text-[11px] text-indigo-500">{p.label}</p>
                          {(p.text || p.spec) && (
                            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)] line-clamp-3 whitespace-pre-wrap">{p.text || p.spec}</p>
                          )}
                          <button
                            type="button"
                            disabled={done}
                            onClick={() => void confirm(mi, pi, p)}
                            className="mt-1.5 px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-500 text-white hover:opacity-90 disabled:opacity-50 cursor-pointer border-0"
                          >
                            {done ? "✓ Applied" : "Confirm & apply"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
          {busy && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)] animate-pulse">
              <span className="inline-block h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Consulting the enquiry…
            </div>
          )}
        </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void send(input); }}
        className="flex gap-2 px-3 py-2.5 border-t border-[var(--border-card)]"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this enquiry…"
          className="flex-1 px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="px-3.5 py-2 bg-brand-indigo text-white font-bold text-xs rounded-xl hover:opacity-90 disabled:opacity-50 cursor-pointer border-0"
        >
          ↑
        </button>
      </form>
    </>
  );

  if (docked) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl shadow-sm flex flex-col overflow-hidden h-full min-h-[320px]">
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[var(--border-card)] bg-[var(--bg-input)]/30">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-indigo/15 text-xs">✨</span>
            <p className="text-xs font-extrabold text-[var(--text-primary)]">Copilot</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Collapse copilot"
            title="Collapse copilot"
            className="p-1 rounded-full hover:bg-[var(--bg-input)] text-[var(--text-secondary)] cursor-pointer bg-transparent border-0 text-base leading-none"
          >
            →
          </button>
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label="Enquiry copilot">
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full sm:w-[400px] bg-[var(--bg-card)] border-l border-[var(--border-card)] shadow-2xl animate-slide-in-right flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-card)]">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-indigo/15 text-sm">✨</span>
            <div>
              <p className="text-sm font-extrabold text-[var(--text-primary)] leading-none">Enquiry copilot</p>
              <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">Answers from this enquiry only</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close copilot"
            className="p-1.5 rounded-full hover:bg-[var(--bg-input)] text-[var(--text-secondary)] cursor-pointer bg-transparent border-0 text-lg leading-none"
          >
            ×
          </button>
        </div>
        {body}
      </aside>
    </div>
  );
}
