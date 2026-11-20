import React, { useState } from "react";
import type { ReactNode } from "react";
import { Agent, Enquiry } from "../types";
import { Card, PriorityBadge } from "./ui";

interface ClientProfileProps {
  selectedEnquiry: Enquiry;
  agents: Agent[];
  redacted?: boolean;
  onUpdateStatus: (id: string, newStatus: Enquiry["status"]) => void;
  onUpdateAgent: (id: string, newAgentId: string) => void;
}

const STAGES: { value: Enquiry["status"]; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "proposal", label: "Proposal" },
  { value: "negotiation", label: "Negotiation" },
  { value: "won", label: "Closed Won" },
  { value: "lost", label: "Closed Lost" },
];

const maskEmail = (email: string) => {
  if (!email) return "";
  const [name, domain] = email.split("@");
  if (domain === undefined) return email;
  return name.length <= 2 ? `${name[0]}***@${domain}` : `${name.slice(0, 2)}***@${domain}`;
};
const maskPhone = (phone: string) => {
  if (!phone) return "";
  if (phone.length <= 6) return "***-***";
  return `${phone.slice(0, 4)} ***-*** ${phone.slice(-3)}`;
};

const selectCls =
  "h-9 w-full cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border-card)] bg-[var(--bg-input)] px-2.5 text-label font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--color-brand-indigo)]";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 px-5 py-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">{title}</h3>
      <dl className="space-y-3">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3">
      <dt className="text-caption font-medium text-[var(--text-secondary)]">{label}</dt>
      <dd className="min-w-0 text-label font-semibold text-[var(--text-primary)]">{children}</dd>
    </div>
  );
}

// Enquiry side panel: Client · Pipeline · Notes. Identity-redacted viewers
// see the source lead only (same gates as before the redesign).
export default function ClientProfile({ selectedEnquiry: e, agents, redacted = false, onUpdateStatus, onUpdateAgent }: ClientProfileProps) {
  const [unmasked, setUnmasked] = useState(false);
  const reveal = (
    <button type="button" onClick={() => setUnmasked(!unmasked)} className="ml-2 flex-shrink-0 cursor-pointer border-0 bg-transparent p-0 text-caption font-semibold text-[var(--color-brand-indigo)] hover:underline">
      {unmasked ? "Hide" : "Reveal"}
    </button>
  );
  const masked = (v: string) => <span className="rounded bg-[var(--bg-input)] px-1.5 py-0.5 font-mono text-caption tracking-wider text-[var(--text-secondary)]">{v}</span>;
  const notes = [
    ...(e.description?.trim() ? [e.description.trim()] : []),
    ...((e.additionalRequirements ?? []) as any[]).map((r) => (typeof r === "string" ? r : r?.text ?? "")).filter((t: string) => t.trim()),
  ];

  if (redacted) {
    return e.sourceLead ? (
      <Card padded={false}><Section title="Enquiry"><Row label="Source lead">{e.sourceLead}</Row></Section></Card>
    ) : null;
  }

  return (
    <Card padded={false} className="divide-y divide-[var(--border-card)] overflow-hidden">
      <div className="px-5 pt-5 pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Client</p>
        <p className="mt-1 font-heading text-card-title leading-snug text-[var(--text-primary)] break-words">{e.clientCompany || "—"}</p>
        {e.location && <p className="mt-0.5 text-caption text-[var(--text-secondary)]">{e.location}</p>}
      </div>

      <Section title="Contact">
        <Row label="Person">{e.contactName || "—"}</Row>
        <Row label="Email">
          <span className="flex items-center justify-between">
            <span className="truncate">{e.contactEmail ? (unmasked ? e.contactEmail : masked(maskEmail(e.contactEmail))) : "—"}</span>
            {e.contactEmail && reveal}
          </span>
        </Row>
        <Row label="Phone">
          <span className="flex items-center justify-between">
            <span className="truncate">
              {!e.contactPhone ? "Not provided" : unmasked
                ? <a href={`tel:${e.contactPhone}`} className="text-[var(--text-primary)] hover:text-[var(--color-brand-indigo)]">{e.contactPhone}</a>
                : masked(maskPhone(e.contactPhone))}
            </span>
            {e.contactPhone && reveal}
          </span>
        </Row>
      </Section>

      <Section title="Pipeline">
        <Row label="EST No."><span className="font-mono text-[var(--color-brand-indigo)]">{e.estNumber || "Not linked yet"}</span></Row>
        <Row label="Stage">
          <select value={e.status} onChange={(ev) => onUpdateStatus(e.id, ev.target.value as Enquiry["status"])} className={selectCls} aria-label="Sales stage">
            {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Row>
        <Row label="Lead by">
          <select value={e.assignedAgentId} onChange={(ev) => onUpdateAgent(e.id, ev.target.value)} className={selectCls} aria-label="Lead by">
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Row>
        <Row label="Priority"><PriorityBadge priority={e.priority} /></Row>
        <Row label="Source">{e.source || "TL"}</Row>
        {e.sourceLead && <Row label="Source lead">{e.sourceLead}</Row>}
      </Section>

      {notes.length > 0 && (
        <section className="space-y-2 px-5 py-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Original request</h3>
          {notes.map((t, i) => (
            <p key={i} className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] px-3 py-2 text-caption leading-relaxed text-[var(--text-secondary)]">{t}</p>
          ))}
        </section>
      )}
    </Card>
  );
}
