"use client";

// ProviderActivity.tsx — the newest deliveries for one provider inside its
// drawer. Opens the full Activity tab for filters, replay and the inspector.

import React from "react";
import { ArrowUpRight, Inbox } from "lucide-react";
import { Button, ChangesBanner, Pager } from "@/components/ui";
import { usePagedQuery } from "@/hooks/usePagedQuery";
import { relAgo } from "@/lib/format";
import type { IngestedRow } from "@/integrations/gateway-types";
import { EmptyState, StatusPill } from "./gateway-ui";

export function ProviderActivity({
  provider, onViewActivity,
}: {
  provider: string;
  onViewActivity: () => void;
}) {
  const query = usePagedQuery<IngestedRow>("/integrations/ingested", {
    events: ["integrations", "data-changed"],
    limit: 8,
    initialQ: provider,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-extrabold text-[var(--text-primary)]">Recent deliveries</h4>
          <p className="text-[10px] text-[var(--text-tertiary)]">Newest events whose staged source starts with <code className="font-mono">{provider}</code>.</p>
        </div>
        <Button size="sm" variant="secondary" icon={<ArrowUpRight size={12} />} onClick={onViewActivity}>Open Activity</Button>
      </div>
      <ChangesBanner count={query.changes} onRefresh={query.refresh} />
      {query.loading && !query.hasData ? (
        <p className="py-6 text-center text-[11px] text-[var(--text-tertiary)]">Loading deliveries…</p>
      ) : query.error && !query.hasData ? (
        <p className="py-6 text-center text-[11px] font-bold text-[var(--color-danger)]">Could not load deliveries.</p>
      ) : !query.rows.length ? (
        <EmptyState icon={<Inbox size={18} />} title="No deliveries yet"
          body="This provider has not posted an event the gateway accepted. Check the webhook URL and secret in Setup." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border-card)]">
          <table className="w-full text-[11px]">
            <thead className="bg-[var(--bg-input)] text-left text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">
              <tr><th className="px-3 py-2">Status</th><th className="px-3 py-2">Event</th><th className="px-3 py-2">Received</th></tr>
            </thead>
            <tbody>
              {query.rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--border-card)]">
                  <td className="px-3 py-2"><StatusPill status={row.status} /></td>
                  <td className="px-3 py-2">
                    <p className="font-semibold text-[var(--text-primary)]">{row.eventType || "event"}</p>
                    <p className="font-mono text-[9px] text-[var(--text-tertiary)]">{row.source}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--text-secondary)]">{relAgo(row.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!query.total && <Pager page={query.page} limit={query.limit} total={query.total} totalPages={query.totalPages} onPage={query.setPage} noun="events" />}
    </div>
  );
}
