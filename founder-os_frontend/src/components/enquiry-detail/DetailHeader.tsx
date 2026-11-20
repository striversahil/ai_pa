import React from "react";
import { Enquiry, enquiryLabel } from "../../types";
import { Badge, Button } from "../ui";
import { enquiryHeading, enquiryRateState, zohoTone } from "@/enquiry/rate-state";

const Icon = ({ d }: { d: string }) => (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d={d} /></svg>
);
const PLUS = "M12 4v16m8-8H4";
const EDIT = "M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z";
const TRASH = "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16";

// Detail page header: back · label/date · title · state chips on the left,
// grouped actions on the right (primary = Add items). Pure presentation —
// EnquiryDetail owns every handler and confirm dialog.
export default function DetailHeader({
  enquiry, redacted, partial, copilotOpen,
  onBack, onAddItems, onEdit, onRevise, onToggleCopilot, onDelete,
}: {
  enquiry: Enquiry;
  redacted: boolean;
  /** Decided vs loop items while still open (null = no partial tag). */
  partial: { decided: number; total: number } | null;
  copilotOpen: boolean;
  onBack: () => void;
  onAddItems: () => void;
  onEdit: () => void;
  /** Present only when a sent enquiry may be reopened. */
  onRevise?: () => void;
  onToggleCopilot: () => void;
  onDelete: () => void;
}) {
  const s = enquiryRateState(enquiry);
  const head = enquiryHeading(enquiry, enquiryLabel(enquiry));
  const rawZoho = String((enquiry as any).zohoStatus ?? "");
  const finalizedUnsent = !s.sent && (enquiry.rateStatus ?? "") === "finalized";
  const logged = enquiry.createdAt ? new Date(enquiry.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";

  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to enquiries"
          title="Back to enquiries"
          className="mt-0.5 flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-card)] bg-[var(--bg-card)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.25"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="min-w-0 space-y-2">
          <h1 className="font-heading text-section font-bold leading-tight tracking-tight text-[var(--text-primary)] break-words">{head.heading}</h1>
          <p className="text-caption text-[var(--text-secondary)]">
            {head.subtitle && <span className="font-medium">{head.subtitle} · </span>}
            {logged && <span className="text-[var(--text-tertiary)]">Logged {logged}</span>}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {!redacted && (
              <span title={s.isZohoSent ? `Zoho: ${s.zohoStatus}` : s.title}>
                <Badge tone={s.sent ? "success" : s.tone} dot>
                  {s.sent ? (s.isZohoSent ? `Sent · Zoho ${s.zohoStatus}` : "Marked as sent") : finalizedUnsent ? "Finalized · awaiting Zoho send" : s.label}
                </Badge>
              </span>
            )}
            {partial && <Badge tone="warning">Partial rates · {partial.decided} of {partial.total}</Badge>}
            {s.overdue && <Badge tone="danger">{s.overdue.label}</Badge>}
            {enquiry.estNumber && rawZoho && (
              <span title="Live Zoho status (5-min sync)"><Badge tone={zohoTone(rawZoho)}>Zoho · {rawZoho}</Badge></span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:justify-end">
        <Button variant="primary" icon={<Icon d={PLUS} />} onClick={onAddItems}>Add items</Button>
        {!redacted && (<>
          <Button icon={<Icon d={EDIT} />} onClick={onEdit}>Edit details</Button>
          {onRevise && (
            <Button onClick={onRevise} title="Reopen for additional scope — new items loop procurement → management → sent again">Reopen for revision</Button>
          )}
          <Button
            onClick={onToggleCopilot}
            aria-pressed={copilotOpen}
            className={copilotOpen ? "!border-[var(--color-brand-indigo)] !text-[var(--color-brand-indigo)]" : ""}
            icon={<span aria-hidden>✨</span>}
          >
            Copilot
          </Button>
          <Button variant="danger" icon={<Icon d={TRASH} />} onClick={onDelete} aria-label="Delete enquiry" title="Delete enquiry">
            Delete
          </Button>
        </>)}
      </div>
    </header>
  );
}
