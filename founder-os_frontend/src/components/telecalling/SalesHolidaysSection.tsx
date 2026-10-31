'use client';

// SalesHolidaysSection — Controller: sales-head/MIS marks national holidays.
// A holiday accrues ₹0 target like a Sunday, so it shrinks that week's due and
// the carry-out deficit. Past or future dates both allowed — the ledger
// recomputes from the start on every dashboard load, so a backdated mark
// retroactively reduces old dues. Sundays are accepted but reported as no-ops.

import { useCallback, useEffect, useState } from 'react';
import { CalendarOff, Trash2 } from 'lucide-react';

interface SalesHoliday {
  day: string;
  label: string;
  markedByName: string;
  createdAt: string;
  sundayNoOp: boolean;
}

export default function SalesHolidaysSection({ refreshAll }: { refreshAll: () => void }) {
  const [holidays, setHolidays] = useState<SalesHoliday[]>([]);
  const [day, setDay] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/telecalling/holidays');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Load failed (${res.status})`);
      setHolidays((body?.holidays ?? []) as SalesHoliday[]);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load holidays');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mark = useCallback(async () => {
    if (!day || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/telecalling/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, label }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Mark failed (${res.status})`);
      const h = body?.holiday as SalesHoliday | undefined;
      setDay('');
      setLabel('');
      if (h?.sundayNoOp) {
        setNotice(`${h.day} is a Sunday — already a non-working day, so the deficit is unchanged.`);
      }
      await load();
      refreshAll();
    } catch (e: any) {
      setError(e?.message ?? 'Mark failed');
    } finally {
      setSaving(false);
    }
  }, [day, label, saving, load, refreshAll]);

  const remove = useCallback(async (target: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/telecalling/holidays/${encodeURIComponent(target)}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Remove failed (${res.status})`);
      await load();
      refreshAll();
    } catch (e: any) {
      setError(e?.message ?? 'Remove failed');
    }
  }, [load, refreshAll]);

  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 space-y-3">
      <div>
        <h3 className="text-lg font-bold flex items-center gap-2">
          <CalendarOff className="w-4 h-4 text-indigo-500" />
          National holidays
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          A marked day accrues no target — past marks shrink old dues, future marks shrink upcoming ones.
          Sundays are already off, so marking one changes nothing.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Date</span>
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Label</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void mark(); }}
            placeholder="Diwali, Holi, …"
            maxLength={120}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => void mark()}
          disabled={saving || !day}
          className="px-4 py-2 text-xs rounded-lg font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? 'Marking…' : 'Mark holiday'}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          {notice}
        </p>
      )}

      {holidays.length === 0 ? (
        <p className="text-[11px] text-zinc-500">No holidays marked — every Mon–Sat accrues the full daily target.</p>
      ) : (
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {holidays.map((h) => (
            <div key={h.day} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2">
              <div className="min-w-0">
                <span className="text-sm font-semibold font-mono">{h.day}</span>
                {h.label && <span className="ml-2 text-xs text-zinc-600 dark:text-zinc-300">{h.label}</span>}
                {h.sundayNoOp && (
                  <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full border border-zinc-300 dark:border-zinc-700 text-zinc-500 font-bold">
                    Sunday · no effect
                  </span>
                )}
                {h.markedByName && (
                  <div className="text-[10px] text-zinc-500">by {h.markedByName}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => void remove(h.day)}
                title={`Unmark ${h.day}`}
                className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
