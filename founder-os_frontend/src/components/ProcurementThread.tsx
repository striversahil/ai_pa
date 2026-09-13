"use client";

import React, { useMemo, useState } from "react";
import type { Comment } from "@/types";

interface ProcurementThreadProps {
  enquiryId: string;
  comments: Comment[];
  currentAgentId: string;
  onAddComment: (c: Comment) => void;
}

/** Shared ops thread for the procurement queue modal: procurement-scope
 *  comments only (server filters too — this is display + composer). */
export default function ProcurementThread({ enquiryId, comments, currentAgentId, onAddComment }: ProcurementThreadProps) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const thread = useMemo(
    () => comments
      .filter((c) => c.enquiryId === enquiryId && (c.visibility ?? "sales") === "procurement")
      .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""))),
    [comments, enquiryId],
  );

  const post = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onAddComment({
        id: `com-${Date.now()}`,
        enquiryId,
        agentId: currentAgentId,
        content: text,
        createdAt: new Date().toISOString(),
        parentId: null,
        visibility: "procurement",
      });
      setInput("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-input)]/20 p-3 space-y-2.5">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
        Ops thread — shared with sales ({thread.length})
      </p>
      {thread.length > 0 && (
        <ul className="space-y-1.5 max-h-56 overflow-y-auto">
          {thread.map((c) => (
            <li key={c.id} className="text-xs bg-[var(--bg-card)] border border-[var(--border-card)]/60 rounded-lg px-2.5 py-1.5">
              <span className="whitespace-pre-wrap text-[var(--text-primary)] font-medium">{c.content}</span>
              <span className="block mt-0.5 text-[10px] text-[var(--text-tertiary)]">
                {c.createdAt ? new Date(c.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={post} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask sales for a spec fix, note a vendor update…"
          className="flex-1 px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="px-3 py-2 bg-brand-indigo text-white font-bold text-xs rounded-lg hover:opacity-90 disabled:opacity-50 cursor-pointer border-0"
        >
          Post
        </button>
      </form>
    </div>
  );
}
