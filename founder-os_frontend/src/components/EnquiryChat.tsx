"use client";

import React, { useState, useRef, useEffect } from "react";

interface ChatProposal {
  kind: "comment" | "spec_fix";
  text?: string;
  scope?: string;
  itemIndex?: number;
  spec?: string;
  label: string;
}

interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  proposals?: ChatProposal[];
}

const SUGGESTIONS = ["What's missing on this enquiry?", "Any past prices for these items?", "Summarize the discussion so far"];

/** Per-enquiry copilot sidebar: scoped tool-using chat. Writes only happen
 *  via explicit Confirm taps (proposals execute through validated endpoints). */
export default function EnquiryChat({ enquiryId }: { enquiryId: string }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMsgs([]);
    setConfirmed(new Set());
  }, [enquiryId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [msgs, busy]);

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

  return (
    <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4 shadow-sm flex flex-col gap-3">
      <p className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
        Enquiry copilot
      </p>
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {msgs.length === 0 && !busy && (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="px-2.5 py-1 text-[11px] font-bold rounded-full border border-brand-indigo/40 text-brand-indigo hover:bg-brand-indigo/10 cursor-pointer bg-transparent"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, mi) => (
          <div key={mi} className={`text-xs leading-relaxed rounded-xl px-3 py-2 whitespace-pre-wrap ${m.role === "user" ? "bg-brand-indigo/10 text-[var(--text-primary)] ml-6" : "bg-[var(--bg-input)]/50 text-[var(--text-primary)] mr-2"}`}>
            {m.text}
            {m.proposals && m.proposals.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {m.proposals.map((p, pi) => {
                  const key = mi * 100 + pi;
                  const done = confirmed.has(key);
                  return (
                    <div key={pi} className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-2.5 py-2">
                      <p className="font-bold text-[11px] text-indigo-500">{p.label}</p>
                      {(p.text || p.spec) && (
                        <p className="mt-0.5 text-[11px] text-[var(--text-secondary)] line-clamp-3">{p.text || p.spec}</p>
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
        ))}
        {busy && <p className="text-[11px] text-[var(--text-tertiary)] animate-pulse">Thinking…</p>}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); void send(input); }}
        className="flex gap-2"
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
          className="px-3 py-2 bg-brand-indigo text-white font-bold text-xs rounded-xl hover:opacity-90 disabled:opacity-50 cursor-pointer border-0"
        >
          Send
        </button>
      </form>
    </div>
  );
}
