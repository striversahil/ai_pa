'use client';

// ClientSegmentSection — Controller: final-consumer vs reseller.
//
// The ₹1L/day region target counts END-CONSUMER accepted ₹ only, so every
// accepted/declined client must resolve to a segment. The queue groups
// estimates by client with the deterministic auto match (exact, then unique
// token-overlap); unclear rows show up to 5 master candidates to pick from,
// otherwise the sales-head marks the client manually. Type rules map a whole
// master family (Flour Mill, Chakki Mill, Maida Plant, …) at once; a manual
// mark always wins and is the only stored row.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';

interface Candidate {
  id: string;
  name: string;
  typeBase: string;
  region: string;
  state: string;
}

interface ClientRow {
  key: string;
  displayName: string;
  segment: 'consumer' | 'reseller' | '';
  source: 'manual' | 'auto' | 'none';
  masterName: string;
  matchKind: string;
  candidates: Candidate[];
  regions: string[];
  estimateCount: number;
  acceptedCount: number;
  acceptedValue: number;
  declinedCount: number;
  declinedValue: number;
  estimates: Array<{
    estimateId: string;
    estimateNumber: string;
    customerName: string;
    total: number;
    region: string;
    status: string;
    day: string;
  }>;
}

interface TypeBase {
  base: string;
  count: number;
  segment: 'consumer' | 'reseller' | '';
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

function segPill(seg: string): string {
  if (seg === 'consumer') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (seg === 'reseller') return 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300';
  return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
}

export default function ClientSegmentSection({ refreshAll }: { refreshAll: () => void }) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [typeBases, setTypeBases] = useState<TypeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'review' | 'all' | 'consumer' | 'reseller'>('review');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/telecalling/client-segments');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Load failed (${res.status})`);
      setClients(Array.isArray(body?.clients) ? body.clients : []);
      setTypeBases(Array.isArray(body?.typeBases) ? body.typeBases : []);
    } catch (e: any) {
      setError(e?.message ?? 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveClient = useCallback(async (clientKey: string, segment: 'consumer' | 'reseller' | '', masterCustomerId?: string) => {
    setSaving(clientKey);
    setError(null);
    try {
      const res = await fetch('/api/telecalling/client-segments', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey, segment, masterCustomerId: masterCustomerId ?? '' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Save failed (${res.status})`);
      await load();
      refreshAll();
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
    } finally {
      setSaving(null);
    }
  }, [load, refreshAll]);

  const saveRule = useCallback(async (typeBase: string, segment: 'consumer' | 'reseller' | '') => {
    setSaving(`rule:${typeBase}`);
    setError(null);
    try {
      const res = await fetch('/api/telecalling/client-type-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typeBase, segment }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Save failed (${res.status})`);
      await load();
      refreshAll();
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
    } finally {
      setSaving(null);
    }
  }, [load, refreshAll]);

  const pending = useMemo(() => clients.filter((c) => !c.segment), [clients]);
  const pendingValue = useMemo(() => pending.reduce((s, c) => s + c.acceptedValue + c.declinedValue, 0), [pending]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clients.filter((c) => {
      if (filter === 'review' && c.segment) return false;
      if (filter === 'consumer' && c.segment !== 'consumer') return false;
      if (filter === 'reseller' && c.segment !== 'reseller') return false;
      if (needle && !c.displayName.toLowerCase().includes(needle) && !c.key.toLowerCase().includes(needle)) return false;
      return true;
    }).slice(0, 120);
  }, [clients, q, filter]);

  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
      <div>
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-500" />
          Client type — final consumer vs reseller
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          The ₹1L/day target counts end-consumer accepted ₹ only. Auto-matched rows resolve
          themselves; unclear rows need a pick or a manual mark. Excluded ₹ never disappears — it
          stays in Won, bifurcated.
        </p>
      </div>

      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2">{error}</p>
      )}

      {/* Type rules: one decision covers a whole master family. */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Master-type rules</span>
        <div className="flex flex-wrap gap-1.5">
          {typeBases.map((t) => (
            <div key={t.base} className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5">
              <span className="text-xs font-semibold">{t.base || 'Unspecified'}</span>
              <span className="text-[10px] text-zinc-500 font-mono">{fmtNum(t.count)}</span>
              <select
                value={t.segment}
                disabled={saving === `rule:${t.base}`}
                onChange={(e) => void saveRule(t.base, e.target.value as 'consumer' | 'reseller' | '')}
                className={`text-[11px] font-bold rounded-lg border px-1.5 py-1 ${segPill(t.segment)}`}
                title="Which segment this whole master family belongs to"
              >
                <option value="consumer">Consumer</option>
                <option value="reseller">Reseller</option>
                <option value="">Unset</option>
              </select>
            </div>
          ))}
          {typeBases.length === 0 && !loading && (
            <p className="text-[11px] text-zinc-500">No master types found.</p>
          )}
        </div>
      </div>

      {/* Queue */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            {pending.length} need review · ₹{fmtNum(pendingValue)}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {(['review', 'all', 'consumer', 'reseller'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 text-[11px] rounded-lg font-bold ${filter === f ? 'bg-indigo-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'}`}
              >
                {f === 'review' ? 'Needs review' : f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search client…"
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs w-40"
            />
          </div>
        </div>

        {loading && <p className="text-xs text-zinc-500">Loading clients…</p>}
        {!loading && visible.length === 0 && (
          <p className="text-xs text-zinc-500">
            {filter === 'review' ? 'Every client is classified. 🎉' : 'No clients match.'}
          </p>
        )}

        <div className="space-y-1.5 max-h-[32rem] overflow-y-auto pr-1">
          {visible.map((c) => (
            <div key={c.key} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{c.displayName}</div>
                  <div className="text-[11px] text-zinc-500 font-mono truncate">
                    {c.acceptedCount} accepted · ₹{fmtNum(c.acceptedValue)}
                    {c.declinedCount > 0 && <span> · {c.declinedCount} declined · ₹{fmtNum(c.declinedValue)}</span>}
                    {c.regions.length > 0 && <span> · {c.regions.join(', ')}</span>}
                  </div>
                  <div className="mt-0.5 text-[10px] text-zinc-500">
                    {c.source === 'manual' && <span>✋ manually marked{c.masterName ? ` → ${c.masterName}` : ''}</span>}
                    {c.source === 'auto' && <span>⚙️ auto: {c.masterName} ({c.matchKind})</span>}
                    {c.source === 'none' && c.matchKind === 'ambiguous' && <span>⚠️ unclear between {c.candidates.length} master rows — pick one</span>}
                    {c.source === 'none' && c.matchKind !== 'ambiguous' && <span>⚠️ no master match — mark manually</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${segPill(c.segment)}`}>
                    {c.segment || 'unclassified'}
                  </span>
                  <button
                    type="button"
                    disabled={saving === c.key}
                    onClick={() => void saveClient(c.key, 'consumer')}
                    className="text-[11px] font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1.5 disabled:opacity-50"
                  >
                    Consumer
                  </button>
                  <button
                    type="button"
                    disabled={saving === c.key}
                    onClick={() => void saveClient(c.key, 'reseller')}
                    className="text-[11px] font-bold rounded-lg bg-violet-600 hover:bg-violet-500 text-white px-2.5 py-1.5 disabled:opacity-50"
                  >
                    Reseller
                  </button>
                  {c.source === 'manual' && (
                    <button
                      type="button"
                      disabled={saving === c.key}
                      onClick={() => void saveClient(c.key, '')}
                      title="Clear the manual mark (back to auto)"
                      className="text-[11px] font-semibold text-zinc-500 hover:text-rose-500 disabled:opacity-50"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {c.candidates.length > 0 && c.source === 'none' && (
                <div className="flex flex-wrap gap-1.5">
                  {c.candidates.map((m) => {
                    const derived = m.typeBase === 'Flour Mill' || m.typeBase === 'Chakki Mill' || m.typeBase === 'Maida Plant' ? 'consumer' : '';
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={saving === c.key || !derived}
                        onClick={() => void saveClient(c.key, derived as 'consumer', m.id)}
                        title={derived ? `Confirm ${m.name} — marks consumer` : 'This master row has no segment rule — mark the client manually above'}
                        className="text-[11px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-1 hover:border-indigo-400 disabled:opacity-50 text-left"
                      >
                        <span className="font-semibold">{m.name}</span>
                        <span className="text-zinc-500"> · {m.typeBase}{m.region ? ` · ${m.region}` : ''}{m.state ? ` ${m.state}` : ''}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {c.estimates.length > 0 && (
                <details className="text-[11px] text-zinc-500">
                  <summary className="cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300">
                    {c.estimateCount} estimate{c.estimateCount === 1 ? '' : 's'}{c.estimateCount > c.estimates.length ? ` (showing ${c.estimates.length})` : ''}
                  </summary>
                  <ul className="mt-1 space-y-0.5 font-mono">
                    {c.estimates.map((e) => (
                      <li key={e.estimateId} className="truncate">
                        {e.estimateNumber} · ₹{fmtNum(e.total)} · {e.status}{e.region ? ` · ${e.region}` : ''}{e.day ? ` · ${e.day}` : ''}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
        {clients.length > visible.length && (
          <p className="text-[10px] text-zinc-500">Showing {visible.length} of {clients.length} — narrow with search or filters.</p>
        )}
      </div>
    </section>
  );
}
