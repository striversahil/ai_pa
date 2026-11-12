"use client";

// LeadsPanel — the Sales → Leads tab (Phase 7c/7d).
//
// Unqualified queue (new leads awaiting TL/head triage) + losses with rates
// (quoted per product per source = price intelligence). Qualify/Drop buttons
// render only when GET /api/leads/me says canQualify — the PUTs re-check
// server-side via requireLeadQualifier, so a forged UI still gets 403.
// Live via useLiveQuery with no events filter (refetch on any data-changed,
// including the Leads live event from qualify/drop).
import React, { useCallback, useMemo, useState } from "react";
import { useLiveQuery } from "@/hooks/useLiveData";
import {
  dropLead, fetchLeadLosses, fetchLeadsMe, fetchUnqualifiedLeads, qualifyLead,
  LEAD_DROP_REASONS, type LeadRow,
} from "@/work/api";

function inr(n: number | null): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "–";
  const v = Number(n);
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`;
  return `₹${v.toLocaleString("en-IN")}`;
}

function LeadCard({ l, canQualify, busy, onQualify, onDrop }: {
  l: LeadRow; canQualify: boolean; busy: string | null;
  onQualify: (id: string) => void; onDrop: (id: string, reason: string) => void;
}) {
  const [reason, setReason] = useState("no_response");
  const who = l.clientCompany || l.customerName || l.contactName || "Unnamed lead";
  return (
    <li className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-3 py-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--text-primary)]">{who}</p>
          <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
            {[l.sourceName, l.region || "no region", l.productText].filter(Boolean).join(" · ").slice(0, 140) || "–"}
          </p>
        </div>
        {l.quotedRateAmount ? (
          <span className="shrink-0 font-mono text-xs font-bold text-[var(--text-primary)]">{inr(l.quotedRateAmount)}</span>
        ) : null}
        {canQualify ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={busy === l.id}
              onClick={() => onQualify(l.id)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              Qualify
            </button>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="rounded-lg border border-[var(--border-card)] bg-transparent px-1 py-1.5 text-xs"
              aria-label="Drop reason"
            >
              {LEAD_DROP_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button
              type="button"
              disabled={busy === l.id}
              onClick={() => onDrop(l.id, reason)}
              className="rounded-lg bg-slate-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              Drop
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

export default function LeadsPanel() {
  const meQuery = useLiveQuery(fetchLeadsMe);
  const queueQuery = useLiveQuery(fetchUnqualifiedLeads);
  const lossQuery = useLiveQuery(fetchLeadLosses);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const canQualify = meQuery.data?.canQualify ?? false;

  const act = useCallback(async (id: string, fn: (id: string) => Promise<unknown>, okMsg: string) => {
    setBusyId(id);
    setMessage("");
    try {
      await fn(id);
      queueQuery.refresh();
      lossQuery.refresh();
    } catch (e: any) {
      setMessage(String(e?.message ?? "failed"));
    } finally {
      setBusyId(null);
    }
    void okMsg;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onQualify = useCallback((id: string) => act(id, (x) => qualifyLead(x), "qualified"), [act]);
  const onDrop = useCallback((id: string, reason: string) => act(id, (x) => dropLead(x, reason), "dropped"), [act]);

  const queue = useMemo(() => queueQuery.data?.leads ?? [], [queueQuery.data]);
  const losses = useMemo(() => lossQuery.data?.leads ?? [], [lossQuery.data]);
  const loading = (queueQuery.loading && !queueQuery.data) || (lossQuery.loading && !lossQuery.data);

  return (
    <div className="space-y-4">
      {message ? <p className="text-xs text-red-600">{message}</p> : null}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          Unqualified queue · {queue.length} awaiting triage
          {canQualify ? "" : " (you can view — only TL / sales-head can qualify)"}
        </h2>
        {loading ? (
          <p className="text-xs text-[var(--text-secondary)]">Loading…</p>
        ) : queue.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border-card)] p-4 text-xs text-[var(--text-secondary)]">
            Queue clear — every lead is qualified or quoted. New telecaller + digital leads land here.
          </p>
        ) : (
          <ul className="space-y-2">
            {queue.map((l) => (
              <LeadCard key={l.id} l={l} canQualify={canQualify} busy={busyId} onQualify={onQualify} onDrop={onDrop} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          Lost quotes · {lossQuery.data?.count ?? losses.length} · {inr(lossQuery.data?.quotedTotal ?? null)} quoted
        </h2>
        {losses.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border-card)] p-4 text-xs text-[var(--text-secondary)]">
            No recorded losses in scope.
          </p>
        ) : (
          <ul className="space-y-2">
            {losses.slice(0, 100).map((l) => (
              <LeadCard key={l.id} l={l} canQualify={false} busy={busyId} onQualify={onQualify} onDrop={onDrop} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
