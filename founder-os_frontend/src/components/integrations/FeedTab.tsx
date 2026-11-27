"use client";

// FeedTab — the activity feed: everything any connected portal sent, normalized
// into one timeline. Server-paged (50/page) with whole-table search; clicking a
// row opens the raw payload, where a mapping change can be replayed.
import React, { useState } from "react";
import { Building2, MapPin, MessageSquare, Package, Phone, Receipt, Search, UserPlus, FileQuestion, Inbox } from "lucide-react";
import { Badge, ChangesBanner, EmptyState, ErrorState, Pager, SearchSelect } from "@/components/ui";
import { usePagedQuery } from "@/hooks/usePagedQuery";
import { KIND_LABEL, inr, relTime } from "@/integrations/format";
import type { IntegrationEventRow, IntegrationSource } from "@/integrations/types";
import { EventDrawer } from "./EventDrawer";

const KINDS = ["lead", "enquiry", "visit", "expense", "order", "message", "raw"];

const KIND_ICON: Record<string, React.ReactNode> = {
  lead: <UserPlus size={14} />,
  enquiry: <FileQuestion size={14} />,
  visit: <MapPin size={14} />,
  expense: <Receipt size={14} />,
  order: <Package size={14} />,
  message: <MessageSquare size={14} />,
  raw: <Inbox size={14} />,
};

const FIELD =
  "h-9 rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] px-2.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--color-brand-indigo)]";

export function FeedTab({ sources }: { sources: IntegrationSource[] }) {
  const [sourceId, setSourceId] = useState("");
  const [kind, setKind] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const feed = usePagedQuery<IntegrationEventRow>("/integrations/events", {
    events: ["ingest"],
    filters: { sourceId: sourceId || undefined, kind: kind || undefined },
  });

  const nameOf = (id: string) => sources.find((s) => s.id === id)?.name ?? (id ? "Removed source" : "—");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[220px]">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            value={feed.q}
            onChange={(e) => feed.setQ(e.target.value)}
            placeholder="Search name, company, phone, email, requirement…"
            className={`${FIELD} w-full pl-8`}
          />
        </label>
        <div className="w-[230px]">
          <SearchSelect
            value={sourceId}
            onChange={setSourceId}
            options={[{ value: "", label: "All connections" }, ...sources.map((s) => ({ value: s.id, label: s.name, hint: s.connector?.name }))]}
            placeholder="All connections"
          />
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={FIELD}>
          <option value="">Every activity</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <ChangesBanner count={feed.changes} onRefresh={feed.refresh} />
      </div>

      {feed.error && !feed.hasData ? (
        <ErrorState title="Could not load the activity feed" message={String((feed.error as any)?.message ?? "")} onRetry={feed.refresh} />
      ) : !feed.hasData ? (
        <p className="py-10 text-center text-xs text-[var(--text-tertiary)]">Loading…</p>
      ) : feed.rows.length === 0 ? (
        <EmptyState
          icon={<Inbox size={20} />}
          title={feed.q || sourceId || kind ? "Nothing matches those filters" : "No activity yet"}
          description={
            feed.q || sourceId || kind
              ? "Clear the search or pick another connection."
              : "Connect a service and paste its webhook URL — every submission lands here within a second."
          }
        />
      ) : (
        <div className="divide-y divide-[var(--border-card)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-card)] bg-[var(--bg-card)]">
          {feed.rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setOpenId(row.id)}
              className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-[var(--surface-soft)]"
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-soft)] text-[var(--color-brand-indigo)]">
                {KIND_ICON[row.kind] ?? KIND_ICON.raw}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-xs font-bold text-[var(--text-primary)]">{row.title || KIND_LABEL[row.kind] || "Activity"}</span>
                  <Badge tone="neutral">{KIND_LABEL[row.kind] ?? row.kind}</Badge>
                  {row.amount != null ? <Badge tone="success">{inr(row.amount)}</Badge> : null}
                  <span className="text-[10px] text-[var(--text-tertiary)]">{relTime(row.occurredAt)}</span>
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-[var(--text-secondary)]">
                  {row.company ? (
                    <span className="inline-flex items-center gap-1">
                      <Building2 size={10} /> {row.company}
                    </span>
                  ) : null}
                  {row.city ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin size={10} /> {row.city}
                    </span>
                  ) : null}
                  {row.phone ? (
                    <span className="inline-flex items-center gap-1">
                      <Phone size={10} /> {row.phone}
                    </span>
                  ) : null}
                  <span className="text-[var(--text-tertiary)]">via {nameOf(row.sourceId)}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {feed.hasData ? <Pager page={feed.page} limit={feed.limit} total={feed.total} totalPages={feed.totalPages} onPage={feed.setPage} noun="activities" /> : null}

      {openId ? <EventDrawer eventId={openId} sourceName={(id) => nameOf(id)} onClose={() => setOpenId(null)} onReplayed={feed.refresh} /> : null}
    </div>
  );
}
