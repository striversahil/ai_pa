import React from "react";
import { Agent, Enquiry, enquiryLabel } from "../types";
import { Badge, StatusBadge, PriorityBadge } from "./ui";
import { enquiryHeading, enquiryRateState, zohoTone } from "@/enquiry/rate-state";

interface EnquiryRowItemProps {
  enq: Enquiry;
  agent: Agent | undefined;
  hideIdentity?: boolean;
  onViewDetail: (id: string) => void;
}

// One scannable row: identity on the left (label · date, title, client ·
// EST), status chips beneath, stage / priority / lead pinned right. Rendered
// inside EnquiryList's divided card — no per-row card chrome.
export default function EnquiryRowItem({ enq, agent, hideIdentity = false, onViewDetail }: EnquiryRowItemProps) {
  const s = enquiryRateState(enq);
  const isField = !hideIdentity && (enq.source === "Field Staff" || agent?.type === "field_staff");
  const rawZoho = String((enq as any).zohoStatus ?? "");
  // Compact row: enquiry number only — the item title shows in the detail view.
  const { heading } = enquiryHeading(enq, enquiryLabel(enq));
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onViewDetail(enq.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onViewDetail(enq.id); } }}
      className="group grid cursor-pointer grid-cols-1 gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--surface-sunken)] focus-visible:bg-[var(--surface-sunken)] focus-visible:outline-none md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6 md:px-5"
    >
      <div className="min-w-0 space-y-1.5">
        <p className="truncate font-heading text-base font-bold leading-snug text-[var(--text-primary)]">{heading}</p>
        {isField && (
          <p className="text-caption text-[var(--color-sky)]" title={`Field Staff referral — lead, region and 20% generator credit belong to ${agent?.name ?? "the field staff"}`}>
            Field Staff{agent?.region ? ` · ${agent.region}` : ""}
          </p>
        )}
        {!hideIdentity && (
          <p className="truncate text-label font-medium text-[var(--text-secondary)]">
            {enq.clientCompany || "—"}
            <span className="mx-1.5 text-[var(--text-tertiary)]">·</span>
            <span className="font-mono text-caption">{enq.estNumber || "No EST yet"}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {!hideIdentity && <span title={s.title}><Badge tone={s.tone} dot>{s.label}</Badge></span>}
          {s.overdue && (
            <Badge tone="danger" className={s.overdue.level >= 1 ? "!bg-[var(--color-danger)] !text-white" : ""}>{s.overdue.label}</Badge>
          )}
          {s.noItems && (
            <span title="No line items yet — open the enquiry and add items before quoting"><Badge tone="violet">⚠ No items</Badge></span>
          )}
          {!hideIdentity && s.notAvailableCount > 0 && !s.sent && (
            <span title={s.notAvailableTitle}><Badge>{s.notAvailableCount} not available</Badge></span>
          )}
          {enq.estNumber && rawZoho && (
            <span title="Live Zoho status (5-min sync)"><Badge tone={zohoTone(rawZoho)}>Zoho · {rawZoho}</Badge></span>
          )}
          {!hideIdentity && s.zohoNameMismatch && (
            <span title={`Client mismatch — Enquiry: "${enq.clientCompany}" vs Zoho: "${s.zohoNameMismatch}" (loosely normalized)`}><Badge tone="warning">⚠ Name mismatch</Badge></span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 md:justify-end">
        {!hideIdentity && <StatusBadge status={enq.status} />}
        <PriorityBadge priority={enq.priority} />
        {!hideIdentity && (
          <div className="flex min-w-0 items-center gap-2 md:w-28">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: agent?.color || "var(--text-tertiary)" }}>
              {agent?.initials || "UN"}
            </span>
            <span className="truncate text-caption font-semibold text-[var(--text-secondary)]">{agent?.name?.split(" ")[0] ?? "Unassigned"}</span>
          </div>
        )}
        <svg className="ml-auto hidden h-4 w-4 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5 md:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  );
}
