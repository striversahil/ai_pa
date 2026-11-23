"use client";
import React, { useState } from "react";
import { Button } from "@/components/ui";
import {
  DESK_LABEL, needsCategory, startTargets,
  type ThreadAttachment, type ThreadCategory, type ThreadDesk,
} from "@/enquiry-threads/types";
import { PrivateNotice } from "./ThreadCard";
import { AttachButton, AttachmentList, useAttachDraft } from "./Attachments";

// Ask a query on one item. Targets follow the desk rules:
// sales → management; management → sales or procurement.
// A sales-facing query carries a CATEGORY (founder decision 2026-11-21):
//   Product query    → shared with Procurement, answered in this same thread
//   Rate negotiation → Management only, never shown to Procurement
const CATEGORY_COPY: Record<ThreadCategory, { title: string; hint: string }> = {
  product_query: {
    title: "Product query",
    hint: "Spec, drawing, availability, feasibility — Management and Procurement answer here together.",
  },
  rate_negotiation: {
    title: "Rate negotiation",
    hint: "Client price or commercial terms — stays with Management only.",
  },
};

export default function NewThreadForm({ desk, onStart, onCancel }: {
  desk: ThreadDesk;
  onStart: (to: ThreadDesk, text: string, attachments: ThreadAttachment[], category?: ThreadCategory) => Promise<unknown>;
  onCancel: () => void;
}) {
  const targets = startTargets(desk);
  const [to, setTo] = useState<ThreadDesk>(targets[0]);
  const [text, setText] = useState("");
  const [category, setCategory] = useState<ThreadCategory>("product_query");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const draft = useAttachDraft();
  const privateThread = (desk === "management" && to === "procurement") || desk === "procurement";
  // A question Management asks Sales is private to those two desks — it is
  // never a procurement product query (founder rule 2026-11-23).
  const mgmtToSales = desk === "management" && to === "sales";
  const withCategory = needsCategory(desk, to);
  const canSend = !busy && !draft.uploading && (!!text.trim() || draft.files.length > 0);

  const submit = () => {
    if (!canSend) return;
    setBusy(true); setErr(null);
    onStart(to, text.trim(), draft.files, withCategory ? category : undefined)
      .then(() => onCancel())
      .catch((e: any) => { setErr(e?.message || "Could not send the query"); setBusy(false); });
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
        {mgmtToSales && <span className="text-caption font-semibold text-[var(--text-tertiary)]">Private with Sales — Procurement never sees this</span>}
      </div>

      {withCategory && (
        <fieldset className="space-y-1.5 rounded-[var(--radius-sm)] border border-[var(--border-card)] bg-[var(--bg-card)] p-2">
          <legend className="px-1 text-caption font-bold text-[var(--text-secondary)]">What are you asking about?</legend>
          {(Object.keys(CATEGORY_COPY) as ThreadCategory[]).map((c) => (
            <label key={c} className={`flex cursor-pointer items-start gap-2 rounded-[var(--radius-sm)] border px-2 py-1.5 ${category === c ? "border-[var(--color-brand-indigo)] bg-[color-mix(in_srgb,var(--color-brand-indigo)_7%,transparent)]" : "border-transparent"}`}>
              <input type="radio" name="thread-category" value={c} checked={category === c}
                onChange={() => setCategory(c)} className="mt-0.5 cursor-pointer accent-[var(--color-brand-indigo)]" />
              <span className="min-w-0">
                <span className="block text-caption font-semibold text-[var(--text-primary)]">{CATEGORY_COPY[c].title}</span>
                <span className="block text-caption font-normal text-[var(--text-tertiary)]">{CATEGORY_COPY[c].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Plain Enter asks (chat behaviour, founder ask 2026-11-21);
          // Shift+Enter keeps the long-form newline.
          if (e.key !== "Enter" || e.shiftKey) return;
          e.preventDefault();
          submit();
        }}
        rows={3}
        placeholder={
          privateThread ? "What do you need on this item?"
            : category === "rate_negotiation" ? "Client price / commercial terms…"
            : "Spec, drawing, availability — what do you need to know?"
        }
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
