"use client";

// IngestedLogsPanel.tsx — hlp_ingested_data, the one staging table every
// provider writes. Shows raw status/timing; the payload itself is never
// echoed (it can carry provider PII). Replay re-runs mapping + routing.

import { useState } from "react";
import { Button, Pager } from "@/components/ui";
import { usePagedQuery } from "@/hooks/usePagedQuery";
import { replayIngested } from "@/integrations/gateway-api";
import type { IngestedRow } from "@/integrations/gateway-types";

const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  processing: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  processed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  dead_letter: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

function when(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
}

export function IngestedLogsPanel() {
  const [status, setStatus] = useState("");
  const [mode, setMode] = useState("");
  const query = usePagedQuery<IngestedRow>("/integrations/ingested", {
    events: ["data-changed"],
    filters: { status: status || undefined, mode: mode || undefined },
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const replay = async (id: string) => {
    setBusyId(id);
    setNote(null);
    try {
      const res = await replayIngested(id);
      setNote(res.ok ? `Replayed → ${res.coreRefId || "processed"}` : `Replay failed: ${res.error}`);
      query.refresh();
    } catch (e: any) {
      setNote(e?.message ?? "Replay failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input className="flex-1 min-w-[10rem] rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs"
          placeholder="Search source / event id / core ref" value={query.q}
          onChange={(e) => query.setQ(e.target.value)} />
        <select className="rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-2 py-1.5 text-xs"
          value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-2 py-1.5 text-xs"
          value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="">Any delivery</option>
          <option value="realtime">realtime</option>
          <option value="batch">batch</option>
        </select>
      </div>

      {note && <p className="text-[11px] font-bold text-[var(--text-secondary)]">{note}</p>}
      {query.loading && !query.hasData && <p className="text-xs text-[var(--text-tertiary)]">Loading staged rows…</p>}
      {!query.loading && !query.rows.length && <p className="text-xs text-[var(--text-tertiary)]">Nothing has been ingested yet.</p>}

      {!!query.rows.length && (
        <div className="overflow-x-auto rounded-lg border border-[var(--border-card)]">
          <table className="w-full text-[11px]">
            <thead className="bg-[var(--bg-input)]/40 text-left text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
              <tr>
                <th className="px-2 py-1.5">Source</th>
                <th className="px-2 py-1.5">Event</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Core ref</th>
                <th className="px-2 py-1.5">Received</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {query.rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--border-card)]/60">
                  <td className="px-2 py-1.5 font-mono">{row.source}{row.instanceKey !== "default" ? `:${row.instanceKey}` : ""}</td>
                  <td className="px-2 py-1.5">{row.eventType || "—"}<span className="block text-[10px] text-[var(--text-tertiary)]">{row.externalEventId || row.id}</span></td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 font-bold ${STATUS_TONE[row.status] ?? ""}`}>{row.status}</span>
                    {row.retryCount > 0 && <span className="ml-1 text-[10px] text-[var(--text-tertiary)]">×{row.retryCount}</span>}
                  </td>
                  <td className="px-2 py-1.5 font-mono">{row.coreRefId || "—"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{when(row.receivedAt)}</td>
                  <td className="px-2 py-1.5 text-right">
                    {row.status !== "processing" && (
                      <Button size="sm" variant="ghost" disabled={busyId === row.id} onClick={() => void replay(row.id)}>
                        {busyId === row.id ? "…" : "Replay"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!!query.total && (
        <Pager page={query.page} limit={query.limit} total={query.total} totalPages={query.totalPages} onPage={query.setPage} noun="rows" />
      )}
    </div>
  );
}
