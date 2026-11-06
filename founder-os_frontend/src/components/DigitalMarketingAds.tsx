'use client';
// DigitalMarketingAds — ADS tab: read-only ad history (DMM logs only).
// Meta dmm-06 → fromDate/toDate window; WhatsApp dmm-08 + Email dmm-09 →
// single-day rows (start=end=dueDate). Data from GET /api/digital-marketing/ads
// (KV-cached, busted on every log write). Mirror: backend
// src/automations/digital-marketing/ads.ts owns the row shape.
import React, { useMemo, useState } from 'react';
import { useLiveDashboard } from '@/hooks/useLiveData';

type AdType = 'meta' | 'whatsapp' | 'email';

interface AdRow {
  id: string;
  type: AdType;
  title: string;
  startDate: string;
  endDate: string;
  durationDays: number | null;
  spend: number | null;
  volume: number | null;
  volumeLabel: string;
  leads: number | null;
  inquiries: number | null;
  category: string | null;
  dataSource: string | null;
  status: string;
  dueDate: string;
  logId: string;
  doneBy: string | null;
  remark: string | null;
  proofCount: number;
}

interface AdsPayload {
  rows: AdRow[];
  total: number;
  generatedAt: string;
}

const inr = (n: number | null) =>
  n === null || n === undefined ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`;
const int = (n: number | null) =>
  n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-IN');

const TYPE_META: Record<AdType, { label: string; icon: string }> = {
  meta: { label: 'Meta', icon: '📣' },
  whatsapp: { label: 'WhatsApp', icon: '💬' },
  email: { label: 'Email', icon: '✉️' },
};

function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '—');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

export default function DigitalMarketingAds() {
  const [typeFilter, setTypeFilter] = useState<'all' | AdType>('all');
  const [query, setQuery] = useState('');
  const ads = useLiveDashboard<AdsPayload>(async () => {
    const res = await fetch('/api/digital-marketing/ads', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Load failed (HTTP ${res.status})`);
    return res.json();
  }, { pollMs: 60000 });

  const rows = useMemo(() => {
    const all = Array.isArray(ads.data?.rows) ? ads.data!.rows : [];
    const q = query.trim().toLowerCase();
    return all.filter((r) => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false;
      if (!q) return true;
      const hay = `${r.title} ${r.category ?? ''} ${r.dataSource ?? ''} ${r.doneBy ?? ''} ${r.remark ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [ads.data, typeFilter, query]);

  const counts = useMemo(() => {
    const all = Array.isArray(ads.data?.rows) ? ads.data!.rows : [];
    return {
      all: all.length,
      meta: all.filter((r) => r.type === 'meta').length,
      whatsapp: all.filter((r) => r.type === 'whatsapp').length,
      email: all.filter((r) => r.type === 'email').length,
    };
  }, [ads.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">📢 ADS — every ad run, with duration</h3>
        <span className="text-[11px] text-zinc-500">Meta window from→to · WhatsApp/Email single-day (start=end=log date)</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {(['all', 'meta', 'whatsapp', 'email'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1 rounded-full text-[11px] font-extrabold cursor-pointer border ${
                typeFilter === t
                  ? 'bg-indigo-600 text-white border-transparent'
                  : 'border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {t === 'all' ? `All (${counts.all})` : `${TYPE_META[t].icon} ${TYPE_META[t].label} (${counts[t]})`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search category / data source / remark…"
          className="flex-1 min-w-[220px] rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs outline-none focus:border-indigo-500"
        />
        {ads.data && (
          <span className="text-[11px] text-zinc-500">
            {rows.length} of {ads.data.total} ads
          </span>
        )}
      </div>

      {ads.loading && !ads.data && (
        <div className="py-10 text-center text-sm text-zinc-500 animate-pulse">Loading ads…</div>
      )}
      {Boolean((ads as any).error) && !ads.data && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-400">
          Failed to load ads: {String((ads as any).error)}{' '}
          <button onClick={() => ads.refresh()} className="ml-2 underline cursor-pointer">Retry</button>
        </div>
      )}
      {ads.data && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">
          No ads found — log Meta / WhatsApp / Email runs in the Tasks tab and they appear here.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[880px] text-xs">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-2 font-extrabold">Type</th>
                <th className="px-3 py-2 font-extrabold">Ad</th>
                <th className="px-3 py-2 font-extrabold">Start</th>
                <th className="px-3 py-2 font-extrabold">End</th>
                <th className="px-3 py-2 font-extrabold text-right">Duration</th>
                <th className="px-3 py-2 font-extrabold text-right">Spend</th>
                <th className="px-3 py-2 font-extrabold text-right">Volume</th>
                <th className="px-3 py-2 font-extrabold text-right">Leads</th>
                <th className="px-3 py-2 font-extrabold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                  <td className="px-3 py-2 whitespace-nowrap font-bold">
                    {TYPE_META[r.type].icon} {TYPE_META[r.type].label}
                  </td>
                  <td className="px-3 py-2 min-w-[180px]">
                    <div className="font-semibold text-zinc-800 dark:text-zinc-200">{r.title}</div>
                    <div className="text-[11px] text-zinc-500">
                      {[r.category, r.dataSource].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono">{fmtDay(r.startDate)}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono">{fmtDay(r.endDate)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap font-mono">
                    {r.durationDays ?? '—'}{r.durationDays ? ` day${r.durationDays === 1 ? '' : 's'}` : ''}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap font-mono">{inr(r.spend)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap font-mono" title={r.volumeLabel}>
                    {int(r.volume)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    {int(r.leads)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      r.status === 'done'
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    }`}>
                      {r.status === 'done' ? '✓ done' : r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
