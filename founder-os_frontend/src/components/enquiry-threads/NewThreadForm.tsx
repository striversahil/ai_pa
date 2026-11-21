"use client";
import React, { useState } from "react";
import { Button } from "@/components/ui";
import { DESK_LABEL, startTargets, type ThreadAttachment, type ThreadDesk } from "@/enquiry-threads/types";
import { PrivateNotice } from "./ThreadCard";
import { AttachButton, AttachmentList, useAttachDraft } from "./Attachments";

// Ask a query on one item. Targets follow the desk rules:
// sales/procurement → management; management → sales or procurement.
export default function NewThreadForm({ desk, onStart, onCancel }: {
  desk: ThreadDesk;
  onStart: (to: ThreadDesk, text: string, attachments: ThreadAttachment[]) => Promise<unknown>;
  onCancel: () => void;
}) {
  const targets = startTargets(desk);
  const [to, setTo] = useState<ThreadDesk>(targets[0]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const draft = useAttachDraft();
  const privateThread = (desk === "management" && to === "procurement") || desk === "procurement";
  const canSend = !busy && !draft.uploading && (!!text.trim() || draft.files.length > 0);

  const submit = () => {
    if (!canSend) return;
    setBusy(true); setErr(null);
    onStart(to, text.trim(), draft.files).then(() => onCancel()).catch((e: any) => { setErr(e?.message || "Could not send the query"); setBusy(false); });
  };

  return (
    <div className="space-y-2 rounded-[var(--radius-control)] border border-dashed border-[var(--border-card)] bg-[var(--surface-sunken)] p-3">
      <div className="flex flex-wrap items-center gap-2 text-caption font-semibold text-[var(--text-secondary)]">
        <span>To</span>
        {targets.length > 1 ? (
          <select value={to} onChange={(e) => setTo(e.target.value as ThreadDesk)} aria-label="Send to"
            className="h-8 cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border-card)] bg-[var(--bg-card)] px-2 text-caption font-semibold text-[var(--text-primary)] outline-none">
            {targets.map((d) => <option key={d} value={d}>{DESK_LABEL[d]}</option>)}
          </select>
        ) : <span className="text-[var(--text-primary)]">{DESK_LABEL[to]}</span>}
        {privateThread && <PrivateNotice />}
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(); }}
        rows={3}
        placeholder={desk === "sales" ? "Rate negotiation, client's spec message, anything about this item…" : "What do you need on this item?"}
        className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--border-card)] bg-[var(--bg-card)] px-3 py-2 text-label font-normal text-[var(--text-primary)] outline-none focus:border-[var(--color-brand-indigo)]"
      />
      <AttachmentList files={draft.files} onRemove={draft.remove} />
      {(err || draft.error) && <p className="text-caption font-semibold text-[var(--color-danger)]">{err || draft.error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AttachButton draft={draft} disabled={busy} />
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={!canSend}>{busy ? "Sending…" : "Send query"}</Button>
        </div>
      </div>
    </div>
  );
}
