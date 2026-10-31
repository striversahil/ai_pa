'use client';

// RehomeEstimateSection — Controller: sales-head/MIS can move ANY estimate to
// any region, regardless of status (sent / accepted / declined) or whether it
// already has a region. Search hits the existing
// GET /api/telecalling/estimates endpoint; moves use the existing
// PUT /api/estimates/:id/region. Moving an accepted estimate re-attributes its
// value/points to the new region on next compute (rewrite, not future-only).

import { useCallback, useState } from 'react';
import { Search, MoveRight } from 'lucide-react';
import { REGIONS, type RegionId } from '@/telecalling/regions';

interface EstimateHit {
  estimateId: string;
  estimateNumber?: string;
  customerName?: string;
  total?: number;
  status?: string;
  region?: string;
  date?: string;
}

interface Props {
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  refreshAll: () => void;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
] as const;

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

export default function RehomeEstimateSection({ busy, setBusy, setError, refreshAll }: Props) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [hits, setHits] = useState<EstimateHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [targetBy, setTargetBy] = useState<Record<string, RegionId | ''>>({});

  const search = useCallback(async () => {
    const query = q.trim();
    if (!query) {
      setHits([]);
      setSearched(false);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: query, status, limit: '20' });
      const res = await fetch(`/api/telecalling/estimates?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Search failed (${res.status})`);
      setHits(((body?.items ?? []) as EstimateHit[]).slice(0, 20));
      setSearched(true);
    } catch (e: any) {
      setError(e?.message ?? 'Search failed');
    } finally {
      setSearching(false);
    }
  }, [q, status, setError]);

  const move = useCallback(async (estimateId: string) => {
    const region = targetBy[estimateId];
    if (!region) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/estimates/${encodeURIComponent(estimateId)}/region`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Move failed (${res.status})`);
      setTargetBy((prev) => {
        const { [estimateId]: _omit, ...rest } = prev;
        return rest;
      });
      setHits((prev) => prev.map((h) => (h.estimateId === estimateId ? { ...h, region } : h)));
      refreshAll();
    } catch (e: any) {
      setError(e?.message ?? 'Move failed');
    } finally {
      setBusy(false);
    }
  }, [targetBy, setBusy, setError, refreshAll]);

  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 space-y-3">
      <div>
        <h3 className="text-lg font-bold flex items-center gap-2">
          <MoveRight className="w-4 h-4 text-indigo-500" />
          Re-home estimates
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          Move any estimate to any region — sent, accepted or declined, mapped or not.
          Moving an accepted estimate re-attributes its value and points to the new region.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Estimate no. or customer</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
            placeholder="EST-023673 or customer name"
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void search()}
          disabled={searching || !q.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs rounded-lg font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
        >
          <Search className="w-3.5 h-3.5" />
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {searched && hits.length === 0 && (
        <p className="text-xs text-zinc-500">No estimates match that search.</p>
      )}

      {hits.length > 0 && (
        <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
          {hits.map((h) => (
            <div key={h.estimateId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                  {h.customerName ?? '—'}
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">
                  {h.estimateNumber ?? h.estimateId} · ₹{fmtNum(Number(h.total ?? 0))} · {h.status ?? '—'}
                  {' · '}in <span className="font-bold">{h.region || 'unmapped'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={targetBy[h.estimateId] ?? ''}
                  onChange={(e) => setTargetBy((prev) => ({ ...prev, [h.estimateId]: e.target.value as RegionId }))}
                  className="px-2 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200"
                >
                  <option value="">Region…</option>
                  {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
                </select>
                <button
                  onClick={() => void move(h.estimateId)}
                  disabled={busy || !targetBy[h.estimateId] || targetBy[h.estimateId] === h.region}
                  title={targetBy[h.estimateId] === h.region ? 'Already in this region' : 'Move to region'}
                  className="text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 disabled:opacity-50"
                >
                  Move
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
