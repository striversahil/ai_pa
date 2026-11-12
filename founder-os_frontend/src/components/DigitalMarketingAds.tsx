"use client";

import { useMemo, useState } from 'react';
import { useLiveDashboard } from '@/hooks/useLiveData';
import { useAuth } from '@/auth/AuthContext';
import type { AdType, AdStatus, AdsPayload } from "./digital-marketing-ads/types";
import { inr, int, TYPE_META } from "./digital-marketing-ads/helpers";
import { AdCard } from "./digital-marketing-ads/AdCard";
import { NewAdRunModal } from "./digital-marketing-ads/NewAdRunModal";

export default function DigitalMarketingAds() {
  const { me } = useAuth();
  const canDelete = !!me && !!(me as any).isAdmin;
  const [typeFilter, setTypeFilter] = useState<'all' | AdType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | AdStatus>('all');
  const [query, setQuery] = useState('');
  const [showNew, setShowNew] = useState(false);
  const ads = useLiveDashboard<AdsPayload>(async () => {
    const res = await fetch('/api/digital-marketing/ads', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Load failed (HTTP ${res.status})`);
    return res.json();
  }, { events: ["digital-marketing"], pollMs: 60000 });

  const rows = useMemo(() => {
    const all = Array.isArray(ads.data?.rows) ? ads.data!.rows : [];
    const q = query.trim().toLowerCase();
    return all.filter((r) => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return `${r.title} ${r.dataDescription ?? ''} ${r.createdBy ?? ''}`.toLowerCase().includes(q);
    });
  }, [ads.data, typeFilter, statusFilter, query]);

  const totals = useMemo(() => {
    const all = Array.isArray(ads.data?.rows) ? ads.data!.rows : [];
    return {
      all: all.length,
      live: all.filter((r) => r.status === 'live').length,
      planned: all.filter((r) => r.status === 'planned').length,
      completed: all.filter((r) => r.status === 'completed').length,
      spend: all.reduce((s, r) => s + (Number(r.amountSpent) || 0), 0),
      leads: all.reduce((s, r) => s + (Number(r.leads) || 0), 0),
      enquiries: all.reduce((s, r) => s + (Number(r.enquiries) || 0), 0),
    };
  }, [ads.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">📢 ADS — campaign runs</h3>
        <span className="text-xs text-zinc-500">live {totals.live} · planned {totals.planned} · completed {totals.completed}</span>
        <div className="ml-auto">
          <button onClick={() => setShowNew(true)} className="px-4 py-2 text-sm font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer border-0 shadow-sm">
            + New Ad Run
          </button>
        </div>
      </div>

      {/* Summary strip */}
      {ads.data && totals.all > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Total spend', value: inr(totals.spend) },
            { label: 'Total leads', value: int(totals.leads) },
            { label: 'Total enquiries', value: int(totals.enquiries) },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">{s.label}</div>
              <div className="mt-0.5 text-xl font-extrabold tabular-nums">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'google', 'meta', 'whatsapp', 'email', 'twitter', 'other'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTypeFilter(t)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold cursor-pointer border ${
              typeFilter === t
                ? 'bg-indigo-600 text-white border-transparent'
                : 'border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {t === 'all' ? `All (${totals.all})` : `${TYPE_META[t].icon} ${TYPE_META[t].label}`}
          </button>
        ))}
        <div className="flex gap-1.5 ml-1">
          {(['all', 'planned', 'live', 'completed'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer border ${
                statusFilter === s
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-transparent'
                  : 'border-zinc-300 dark:border-zinc-700 text-zinc-500'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title / data description…"
          className="flex-1 min-w-[220px] rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3.5 py-2 text-sm outline-none focus:border-indigo-500"
        />
        {ads.data && <span className="text-xs text-zinc-500">{rows.length} of {ads.data.total} ads</span>}
      </div>

      {ads.loading && !ads.data && (
        <div className="py-10 text-center text-sm text-zinc-500 animate-pulse">Loading ads…</div>
      )}
      {Boolean((ads as any).error) && !ads.data && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-400">
          Failed to load ads: {String((ads as any).error)}{' '}
          <button onClick={() => ads.refresh()} className="ml-2 underline cursor-pointer">Retry</button>
        </div>
      )}
      {ads.data && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center text-sm text-zinc-500">
          No ad runs yet — click <b>+ New Ad Run</b> to log the first campaign.
        </div>
      )}

      {rows.length > 0 && (
        <div className="grid gap-4">
          {rows.map((r) => <AdCard key={r.id} r={r} onChanged={() => ads.refresh()} canDelete={canDelete} />)}
        </div>
      )}

      {showNew && <NewAdRunModal onClose={() => setShowNew(false)} onCreated={() => ads.refresh()} />}
    </div>
  );
}
