"use client";
import React, { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { DESK_LABEL, counterpart, type EnquiryThread, type ThreadDesk } from "@/enquiry-threads/types";

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};

/** Lock banner for management <-> procurement threads (never served to sales). */
export function PrivateNotice({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-[var(--color-violet)]" title="Management ↔ Procurement only — never visible to the Sales team">
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" aria-hidden><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 118 0v4" /></svg>
      {compact ? "Private" : "Private · Management ↔ Procurement · hidden from Sales"}
    </span>
  );
}

// One conversation: header (who · item · status) · messages · reply box +
// resolve/reopen. Management on a Sales thread can also ask Procurement
// (opens a separate private thread — Sales never sees it).
export default function ThreadCard({ thread: t, desk, onReply, onResolve, onReopen, onForward, onOpenEnquiry, defaultOpen = true, showItem = true }: {
  thread: EnquiryThread;
  desk: ThreadDesk;
  onReply: (text: string) => Promise<unknown>;
  onResolve: () => Promise<unknown>;
  onReopen: () => Promise<unknown>;
  onForward?: (text: string) => Promise<unknown>;
  /** Inbox only: jump to the enquiry this thread belongs to. */
  onOpenEnquiry?: () => void;
  defaultOpen?: boolean;
  /** false inside a per-item group (the group header already names the item). */
  showItem?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"reply" | "forward">("reply");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const other = counterpart(t, desk);
  const resolved = t.status === "resolved";
  const myTurn = !resolved && t.waitingOn === desk;
  const canForward = !!onForward && desk === "management" && t.channel === "sales";

  const run = (p: () => Promise<unknown>, clear = false) => {
    setBusy(true); setErr(null);
    p().then(() => { if (clear) { setText(""); setMode("reply"); } })
      .catch((e: any) => setErr(e?.message || "Action failed"))
      .finally(() => setBusy(false));
  };
  const send = () => {
    const v = text.trim();
    if (!v || busy) return;
    run(() => (mode === "forward" && onForward ? onForward(v) : onReply(v)), true);
  };

  return (
    <article className={`rounded-[var(--radius-control)] border bg-[var(--bg-card)] ${myTurn ? "border-[color-mix(in_srgb,var(--color-brand-indigo)_45%,transparent)]" : "border-[var(--border-card)]"}`}>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full cursor-pointer items-start justify-between gap-3 border-0 bg-transparent px-4 py-3 text-left">
        <div className="min-w-0 space-y-1">
          <p className="text-label font-semibold text-[var(--text-primary)]">
            {t.enquiryLabel && <span className="text-[var(--color-brand-indigo)]">{t.enquiryLabel} · </span>}
            {showItem ? <>Item {t.itemIndex + 1}{t.itemName ? ` — ${t.itemName}` : ""}</> : <>Conversation with {DESK_LABEL[other]}</>}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-[var(--text-secondary)]">
            {showItem && <span>With {DESK_LABEL[other]}</span>}
            {t.channel === "internal" && <PrivateNotice compact />}
            <span className="text-[var(--text-tertiary)]">· {t.messages.length} message{t.messages.length === 1 ? "" : "s"} · {when(t.updatedAt)}</span>
          </p>
        </div>
        <span className="flex flex-shrink-0 items-center gap-1.5">
          {resolved ? <Badge tone="success" dot>Resolved</Badge>
            : myTurn ? <Badge tone="brand" dot>Your reply</Badge>
            : <Badge tone="neutral" dot>Waiting on {DESK_LABEL[t.waitingOn]}</Badge>}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-[var(--border-card)] px-4 py-3">
          {t.channel === "internal" && <PrivateNotice />}
          <ol className="space-y-2">
            {t.messages.map((m) => m.system ? (
              <li key={m.id} className="text-center text-caption text-[var(--text-tertiary)]">{m.text} · {when(m.at)}</li>
            ) : (
              <li key={m.id} className={`flex ${m.by === desk ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-[var(--radius-sm)] px-3 py-2 ${m.by === desk ? "bg-[color-mix(in_srgb,var(--color-brand-indigo)_10%,transparent)]" : "bg-[var(--surface-sunken)]"}`}>
                  <p className="text-caption font-semibold text-[var(--text-secondary)]">{DESK_LABEL[m.by]}{m.authorName ? ` · ${m.authorName}` : ""} <span className="font-normal text-[var(--text-tertiary)]">· {when(m.at)}</span></p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-label font-normal text-[var(--text-primary)]">{m.text}</p>
                </div>
              </li>
            ))}
          </ol>

          {mode === "forward" && (
            <p className="rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--color-violet)_8%,transparent)] px-3 py-2 text-caption text-[var(--text-secondary)]">
              Opens a <b>private</b> thread with Procurement on this item. Sales will not see it — reply to Sales here once you have the answer.
            </p>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); }}
            rows={2}
            placeholder={mode === "forward" ? "Question for Procurement…" : resolved ? `Reply to reopen — ${DESK_LABEL[other]} will see it` : `Reply to ${DESK_LABEL[other]}…`}
            className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--border-card)] bg-[var(--bg-input)] px-3 py-2 text-label font-normal text-[var(--text-primary)] outline-none focus:border-[var(--color-brand-indigo)]"
          />
          {err && <p className="text-caption font-semibold text-[var(--color-danger)]">{err}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {resolved
                ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(onReopen)}>Reopen</Button>
                : <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(onResolve)}>✓ Mark resolved</Button>}
              {canForward && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode(mode === "forward" ? "reply" : "forward")}>
                  {mode === "forward" ? "Cancel" : "Ask Procurement privately"}
                </Button>
              )}
              {onOpenEnquiry && <Button size="sm" variant="ghost" onClick={onOpenEnquiry}>Open enquiry →</Button>}
            </div>
            <Button size="sm" variant="primary" disabled={busy || !text.trim()} onClick={send}>
              {busy ? "Sending…" : mode === "forward" ? "Send to Procurement" : "Send"}
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
