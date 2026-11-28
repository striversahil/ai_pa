"use client";

// DeliveriesTab.tsx — the paged ingest ledger. Search and filters are
// server-side; a live write raises the shared change banner instead of
// reloading under the operator. Replay is always confirmed.

import React, { useState } from "react";
import { AlertTriangle, ArrowUpRight, Inbox, RefreshCw, RotateCcw, Search } from "lucide-react";
import { Badge, Button, ChangesBanner, Pager } from "@/components/ui";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { usePagedQuery } from "@/hooks/usePagedQuery";
import { relAgo } from "@/lib/format";
import { replayIngested } from "@/integrations/gateway-api";
import type { IngestedRow, SourceStat } from "@/integrations/gateway-types";
import { EmptyState, StatusPill, inputClass, selectClass } from "./gateway-ui";
import { EventDrawer } from "./EventDrawer";

export function DeliveriesTab({
  sources, initialQuery = "", onChanged, onNotice,
}: {
  sources: SourceStat[];
  initialQuery?: string;
  onChanged: () => void;
  onNotice: (message: string, tone?: "success" | "danger") => void;
}) {
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [mode, setMode] = useState("");
  const [openId, setOpenId] = useState("");
  const [replayRow, setReplayRow] = useState<IngestedRow | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const query = usePagedQuery<IngestedRow>("/integrations/ingested", {
    events: ["integrations", "data-changed"],
    filters: { source, status, mode },
    initialQ: initialQuery,
  });

  const doReplay = async () => {
    if (!replayRow) return;
    setBusyId(replayRow.id);
    setError("");
    try {
      const result = await replayIngested(replayRow.id);
      onNotice(
        result.ok ? "Replay completed with the current mapping." : result.error || "Replay finished with an error.",
        result.ok ? "success" : "danger",
      );
      setReplayRow(null);
      query.refresh();
      onChanged();
    } catch (caught: any) {
      setError(String(caught?.message || "Replay failed"));
    } finally {
      setBusyId("");
    }
  };

  const counts = sources.reduce((sum, row) => sum + row.n, 0);
  const activeFilters = !!source || !!status || !!mode || !!query.q;
  const clearAll = () => { setSource(""); setStatus(""); setMode(""); query.setQ(""); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-[var(--text-primary)]">Activity</h2>
          <p className="text-[11px] text-[var(--text-secondary)]">Every accepted webhook, mapped result and dead letter. {counts.toLocaleString("en-IN")} events across {sources.length} sources.</p>
        </div>
        <Button size="sm" variant="secondary" icon={<RefreshCw size={12} />} onClick={query.refresh} disabled={query.refreshing}>{query.refreshing ? "Refreshing…" : "Refresh"}</Button>
      </div>

      {(error || !!query.error) && (
        <p className="flex items-center gap-1.5 rounded-xl bg-[var(--color-danger)]/10 px-3 py-2 text-[11px] font-bold text-[var(--color-danger)]">
          <AlertTriangle size={12} /> {error || String(query.error || "Could not load the ingest log.")}
        </p>
      )}

      <div className="grid gap-2 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="relative sm:col-span-2 xl:col-span-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input className={`${inputClass} pl-8`} value={query.q} onChange={(event) => query.setQ(event.target.value)} placeholder="Search source, event or core ref…" />
        </div>
        <select className={selectClass} value={source} onChange={(event) => setSource(event.target.value)} aria-label="Filter by source">
          <option value="">All sources</option>
          {sources.map((row) => <option key={row.source} value={row.source}>{row.source}</option>)}
        </select>
        <select className={selectClass} value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
          <option value="">Any status</option>
          <option value="processed">Processed</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="dead_letter">Dead letter</option>
        </select>
        <div className="flex items-center gap-1 rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] p-1">
          {[["", "All"], ["realtime", "Real-time"], ["batch", "Batch"]].map(([value, label]) => (
            <button key={value} type="button" onClick={() => setMode(value)}
              className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-bold ${mode === value ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-tertiary)]"}`}>{label}</button>
          ))}
        </div>
      </div>

      {activeFilters && (
        <div className="flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
          <span>Filtered view</span>
          <button type="button" onClick={clearAll} className="font-bold text-[var(--color-brand-indigo)] hover:underline">Clear filters</button>
        </div>
      )}

      <ChangesBanner count={query.changes} onRefresh={query.refresh} />

      {query.loading && !query.hasData ? (
        <div className="space-y-2 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3">
          {[0, 1, 2, 3].map((n) => <div key={n} className="h-8 animate-pulse rounded-lg bg-[var(--bg-input)]" />)}
        </div>
      ) : !query.rows.length ? (
        <EmptyState icon={<Inbox size={18} />} title={activeFilters ? "No events match" : "No events yet"}
          body={activeFilters ? "Change the filters or search text." : "Point a provider webhook at its Setup URL; accepted events land here."}
          action={activeFilters ? <Button size="sm" onClick={clearAll}>Clear filters</Button> : undefined} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[11px]">
              <thead className="bg-[var(--bg-input)] text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">
                <tr>
                  <th className="px-3 py-2.5 font-bold">Status</th>
                  <th className="px-3 py-2.5 font-bold">Source / event</th>
                  <th className="px-3 py-2.5 font-bold">Mode</th>
                  <th className="px-3 py-2.5 font-bold">Attempts</th>
                  <th className="px-3 py-2.5 font-bold">Received</th>
                  <th className="px-3 py-2.5 text-right font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {query.rows.map((row) => (
                  <tr key={row.id} onClick={() => setOpenId(row.id)} className="cursor-pointer border-t border-[var(--border-card)] transition hover:bg-[var(--bg-input)]/60">
                    <td className="px-3 py-2.5"><StatusPill status={row.status} /></td>
                    <td className="px-3 py-2.5">
                      <p className="font-mono text-[10px] font-semibold text-[var(--text-primary)]">{row.source}</p>
                      <p className="truncate text-[10px] text-[var(--text-tertiary)]">{row.eventType || "event"} · {row.externalEventId || "no external id"}</p>
                      {row.coreRefId ? <p className="truncate font-mono text-[9px] text-[var(--color-success)]">→ {row.coreRefId}</p> : null}
                      {row.error ? <p className="truncate text-[9px] font-semibold text-[var(--color-danger)]">{row.error}</p> : null}
                    </td>
                    <td className="px-3 py-2.5"><Badge tone="neutral">{row.deliveryMode || "—"}</Badge></td>
                    <td className="px-3 py-2.5 tabular-nums text-[var(--text-secondary)]">{row.attempts}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[var(--text-secondary)]"><span title={row.receivedAt}>{relAgo(row.receivedAt)}</span></td>
                    <td className="px-3 py-2.5 text-right" onClick={(event) => event.stopPropagation()}>
                      <div className="inline-flex items-center gap-1">
                        <Button size="sm" variant="ghost" icon={<ArrowUpRight size={12} />} onClick={() => setOpenId(row.id)}>Open</Button>
                        {row.status !== "processing" && (
                          <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} onClick={() => setReplayRow(row)}>Replay</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!!query.total && (
        <Pager page={query.page} limit={query.limit} total={query.total} totalPages={query.totalPages} onPage={query.setPage} noun="events" />
      )}

      {openId && <EventDrawer id={openId} onClose={() => setOpenId("")} onChanged={() => { query.refresh(); onChanged(); }} onNotice={onNotice} />}

      <ConfirmDialog
        open={!!replayRow}
        title="Replay this event?"
        message={<>Replay reruns the <b>current</b> mapper over the stored raw body. It does not re-send the webhook and can create or update the mapped record. This is how a fixed mapping repairs an event.</>}
        confirmLabel="Replay event"
        busy={!!busyId}
        onCancel={() => setReplayRow(null)}
        onConfirm={() => void doReplay()}
      />
    </div>
  );
}