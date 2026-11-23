"use client";
import React, { useState } from "react";
import { Badge, Button } from "@/components/ui";
import {
  CATEGORY_LABEL, DESK_LABEL, counterpart, isMyTurn,
  type EnquiryThread, type ThreadAttachment, type ThreadDesk,
} from "@/enquiry-threads/types";
import { AttachButton, AttachmentList, useAttachDraft } from "./Attachments";

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

/** Procurement answering a product query speaks as Management (founder
 *  decision 2026-11-21). Shown on the procurement + management surfaces only —
 *  never to Sales. */
export function ReplyAsManagement() {
  return (
    <p className="rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--color-violet)_8%,transparent)] px-3 py-2 text-caption text-[var(--text-secondary)]">
      🔒 <b>You are replying as Management.</b> Sales will not see your name, your desk, or that Procurement was
      involved. Do not name suppliers, vendors or quote amounts — Sales never sees vendor information.
    </p>
  );
}

const CATEGORY_TONE: Record<string, string> = {
  product_query: "border-violet-500/30 bg-violet-500/10 text-[var(--color-violet)]",
  rate_negotiation: "border-amber-500/30 bg-amber-500/10 text-amber-300",
};

// One conversation: header (category · item · status) · messages · reply box +
// resolve/reopen. A product query is shared with Procurement from the moment
// it is raised — no forwarding step (procurement's replies read as Management).
export default function ThreadCard({ thread: t, desk, onReply, onResolve, onReopen, onOpenEnquiry, defaultOpen = true, showItem = true }: {
  thread: EnquiryThread;
  desk: ThreadDesk;
  onReply: (text: string, attachments: ThreadAttachment[]) => Promise<unknown>;
  onResolve: () => Promise<unknown>;
  onReopen: () => Promise<unknown>;
  /** Inbox only: jump to the enquiry this thread belongs to. */
  onOpenEnquiry?: () => void;
  defaultOpen?: boolean;
  /** false inside a per-item group (the group header already names the item). */
  showItem?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const other = counterpart(t, desk);
  const resolved = t.status === "resolved";
  const myTurn = isMyTurn(t, desk);
  const draft = useAttachDraft();
  const canSend = !busy && !draft.uploading && (!!text.trim() || draft.files.length > 0);
  const waiting = (t.waitingOnAll ?? [t.waitingOn]).filter((d) => d !== desk);
  const waitingLabel = waiting.length === 0 ? "the other side" : waiting.map((d) => DESK_LABEL[d]).join(" / ");

  const run = (p: () => Promise<unknown>, clear = false) => {
    setBusy(true); setErr(null);
    p().then(() => { if (clear) { setText(""); draft.clear(); } })
      .catch((e: any) => setErr(e?.message || "Action failed"))
      .finally(() => setBusy(false));
  };
  const send = () => {
    if (!canSend) return;
    run(() => onReply(text.trim(), draft.files), true);
  };

  return (
    <article className={`rounded-[var(--radius-control)] border bg-[var(--bg-card)] ${myTurn ? "border-[color-mix(in_srgb,var(--color-brand-indigo)_45%,transparent)]" : "border-[var(--border-card)]"}`}>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full cursor-pointer items-start justify-between gap-3 border-0 bg-transparent px-4 py-3 text-left">
        <div className="min-w-0 space-y-1">
          <p className="text-label font-semibold text-[var(--text-primary)]">
            {t.enquiryLabel && <span className="text-[var(--color-brand-indigo)]">{t.enquiryLabel} · </span>}
            {showItem ? <>Item {t.itemIndex + 1}{t.itemName ? ` — ${t.itemName}` : ""}</> : <>Query with {DESK_LABEL[other]}</>}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-[var(--text-secondary)]">
            {showItem && <span>With {DESK_LABEL[other]}</span>}
            {t.category && (
              <span className={`rounded border px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide ${CATEGORY_TONE[t.category]}`}>
                {CATEGORY_LABEL[t.category]}
              </span>
            )}
            {t.channel === "internal" && <PrivateNotice compact />}
            <span className="text-[var(--text-tertiary)]">· {t.messages.length} message{t.messages.length === 1 ? "" : "s"} · {when(t.updatedAt)}</span>
          </p>
        </div>
        <span className="flex flex-shrink-0 items-center gap-1.5">
          {resolved ? <Badge tone="success" dot>Resolved</Badge>
            : myTurn ? <Badge tone="brand" dot>Your reply</Badge>
            : <Badge tone="neutral" dot>Waiting on {waitingLabel}</Badge>}
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
                  <p className="text-caption font-semibold text-[var(--text-secondary)]">
                    {DESK_LABEL[m.by]}{m.authorName && m.authorName !== DESK_LABEL[m.by] ? ` · ${m.authorName}` : ""}{' '}
                    <span className="font-normal text-[var(--text-tertiary)]">· {when(m.at)}</span>
                    {/* Transparency for management/procurement only. Sales is
                        served masked messages with no marker at all (founder
                        rule: no trace of the procurement hand-off). */}
                    {desk !== "sales" && m.masked && (
                      <span className="ml-1.5 rounded bg-[color-mix(in_srgb,var(--color-violet)_14%,transparent)] px-1 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-[var(--color-violet)]">
                        Shown to Sales as Management
                      </span>
                    )}
                  </p>
                  {m.text && <p className="mt-0.5 whitespace-pre-wrap break-words text-label font-normal text-[var(--text-primary)]">{m.text}</p>}
                  <AttachmentList files={m.attachments ?? []} />
                </div>
              </li>
            ))}
          </ol>

          {desk === "procurement" && t.channel === "sales" && !resolved && <ReplyAsManagement />}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Plain Enter sends (chat behaviour, founder ask 2026-11-21);
              // Shift+Enter is the newline escape. Ctrl/Cmd+Enter still sends
              // for people used to the old chord.
              if (e.key !== "Enter") return;
              if (e.shiftKey) return;
              e.preventDefault();
              send();
            }}
            rows={2}
            placeholder={
              desk === "procurement" && t.channel === "sales" ? "Answer as Management…"
                : resolved ? `Reply to reopen — ${DESK_LABEL[other]} will see it`
                : `Reply to ${DESK_LABEL[other]}…`
            }
            className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--border-card)] bg-[var(--bg-input)] px-3 py-2 text-label font-normal text-[var(--text-primary)] outline-none focus:border-[var(--color-brand-indigo)]"
          />
          <AttachmentList files={draft.files} onRemove={draft.remove} />
          {(err || draft.error) && <p className="text-caption font-semibold text-[var(--color-danger)]">{err || draft.error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <AttachButton draft={draft} disabled={busy} />
              {resolved
                ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(onReopen)}>Reopen</Button>
                : <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(onResolve)}>✓ Mark resolved</Button>}
              {onOpenEnquiry && <Button size="sm" variant="ghost" onClick={onOpenEnquiry}>Open enquiry →</Button>}
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden text-caption text-[var(--text-tertiary)] sm:inline">Enter to send · Shift+Enter for a new line</span>
              <Button size="sm" variant="primary" disabled={!canSend} onClick={send}>
                {busy ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
