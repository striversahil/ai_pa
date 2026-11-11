'use client';
// DigitalMarketingAds — ADS tab: manual ad-run registry (migration 0113).
// Overhauled UI: summary stat strip, full-width readable cards with KPI tiles
// + date progress bar, larger type/status controls, roomy edit section.
// Mirror: backend src/automations/digital-marketing/ads.ts owns the row shape.
import React, { useMemo, useState } from 'react';
import { useLiveDashboard } from '@/hooks/useLiveData';
import { useAuth } from '@/auth/AuthContext';

type AdType = 'google' | 'meta' | 'whatsapp' | 'email' | 'twitter' | 'other';
type AdStatus = 'planned' | 'live' | 'completed';

interface AdAttachment {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
  url: string;
}

interface AdRow {
  id: string;
  type: AdType;
  title: string;
  startDate: string;
  endDate: string;
  durationDays: number | null;
  amountSpent: number;
  leads: number;
  enquiries: number;
  dataDescription: string;
  status: AdStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: AdAttachment[];
}

interface AdsPayload {
  rows: AdRow[];
  total: number;
  generatedAt: string;
}

const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`;
const int = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-IN');

const TYPE_META: Record<AdType, { label: string; icon: string; badge: string }> = {
  google: { label: 'Google', icon: '🔍', badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30' },
  meta: { label: 'Meta', icon: '📣', badge: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30' },
  whatsapp: { label: 'WhatsApp', icon: '💬', badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  email: { label: 'Email', icon: '✉️', badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30' },
  twitter: { label: 'Twitter', icon: '𝕏', badge: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 border-zinc-500/30' },
  other: { label: 'Other', icon: '📌', badge: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30' },
};

function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '—');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

function todayIST(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).slice(0, 10);
  } catch { return new Date().toISOString().slice(0, 10); }
}

/** 0–100 progress of today between start/end (clamped). Null when dates invalid. */
function dateProgress(start: string, end: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return null;
  const t = todayIST();
  if (t <= start) return 0;
  if (t >= end) return 100;
  const total = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round(((Date.parse(t) - Date.parse(start)) / total) * 100);
}

const inputCls =
  'w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500';
const labelCls = 'text-xs font-bold text-zinc-600 dark:text-zinc-300';

async function uploadAdFile(adId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/digital-marketing/ads/${encodeURIComponent(adId)}/files`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
}

function NewAdRunModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<AdType>('meta');
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [amountSpent, setAmountSpent] = useState('');
  const [dataDescription, setDataDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!title.trim()) { setErr('Title required'); return; }
    if (!startDate) { setErr('Start date required'); return; }
    if (!endDate) { setErr('End date required'); return; }
    if (endDate < startDate) { setErr('End date must be on or after start date'); return; }
    if (!dataDescription.trim()) { setErr('Describe the data used for this ad'); return; }
    if (!file) { setErr('Attach the data file (pdf / excel / csv / image / zip)'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/digital-marketing/ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title: title.trim(),
          startDate,
          endDate,
          amountSpent: amountSpent === '' ? 0 : Number(amountSpent),
          leads: 0,
          enquiries: 0,
          dataDescription: dataDescription.trim(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created = await res.json();
      await uploadAdFile(String(created.id), file);
      onCreated();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-extrabold">+ New Ad Run</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer border-0 bg-transparent text-xl leading-none">✕</button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelCls}>
            Type of Ad *
            <select value={type} onChange={(e) => setType(e.target.value as AdType)} className={`${inputCls} mt-1.5`}>
              {(Object.keys(TYPE_META) as AdType[]).map((t) => (
                <option key={t} value={t}>{TYPE_META[t].icon} {TYPE_META[t].label}</option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            Title *
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Diwali Wire-Mesh push" className={`${inputCls} mt-1.5`} />
          </label>
          <label className={labelCls}>
            Start date *
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`${inputCls} mt-1.5`} />
          </label>
          <label className={labelCls}>
            End date *
            <input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} className={`${inputCls} mt-1.5`} />
          </label>
        </div>
        <label className={`block ${labelCls}`}>
          Amount spent (₹)
          <input type="number" min={0} value={amountSpent} onChange={(e) => setAmountSpent(e.target.value)} placeholder="0" className={`${inputCls} mt-1.5`} />
        </label>
        <label className={`block ${labelCls}`}>
          Data used — description *
          <textarea value={dataDescription} onChange={(e) => setDataDescription(e.target.value)} rows={3} placeholder="Which list / database was used for this campaign…" className={`${inputCls} mt-1.5`} />
        </label>
        <label className={`block ${labelCls}`}>
          Data file (pdf / excel / csv / image / zip) *
          <span className="mt-1.5 flex items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 px-4 py-6 text-sm font-medium text-zinc-500 cursor-pointer hover:border-indigo-500 hover:text-indigo-500">
            {file ? `📎 ${file.name} · ${(file.size / 1024).toFixed(1)} KB — click to change` : '📎 Click to attach the data file'}
            <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </span>
        </label>
        {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-500">{err}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-500 cursor-pointer">Cancel</button>
          <button disabled={busy} onClick={submit} className="px-4 py-2 text-sm font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 cursor-pointer border-0">
            {busy ? 'Creating…' : 'Create Ad Run'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: AdStatus }) {
  const cls = status === 'live'
    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
    : status === 'planned'
      ? 'bg-indigo-500/15 text-indigo-500 border-indigo-500/30'
      : 'bg-zinc-500/15 text-zinc-500 border-zinc-500/30';
  const dot = status === 'live' ? '●' : status === 'planned' ? '○' : '✓';
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-extrabold ${cls}`}>
      {dot} {status}
    </span>
  );
}

function AdCard({ r, onChanged, canDelete }: { r: AdRow; onChanged: () => void; canDelete: boolean }) {
  const [open, setOpen] = useState(false);
  const [spend, setSpend] = useState(String(r.amountSpent ?? 0));
  const [leads, setLeads] = useState(String(r.leads ?? 0));
  const [enquiries, setEnquiries] = useState(String(r.enquiries ?? 0));
  const [desc, setDesc] = useState(r.dataDescription ?? '');
  const [status, setStatus] = useState<AdStatus>(r.status);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  React.useEffect(() => {
    setSpend(String(r.amountSpent ?? 0));
    setLeads(String(r.leads ?? 0));
    setEnquiries(String(r.enquiries ?? 0));
    setDesc(r.dataDescription ?? '');
    setStatus(r.status);
  }, [r]);

  const progress = dateProgress(r.startDate, r.endDate);
  const cpl = r.leads > 0 ? r.amountSpent / r.leads : null;

  const save = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/digital-marketing/ads/${encodeURIComponent(r.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountSpent: Number(spend),
          leads: Number(leads),
          enquiries: Number(enquiries),
          dataDescription: desc,
          status,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const attach = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      await uploadAdFile(r.id, f);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (id: string) => {
    try {
      const res = await fetch(`/api/digital-marketing/ads/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Remove failed');
    }
  };

  const removeAd = async () => {
    setErr(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/digital-marketing/ads/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-extrabold ${TYPE_META[r.type]?.badge ?? ''}`}>
              {TYPE_META[r.type]?.icon} {TYPE_META[r.type]?.label ?? r.type}
            </span>
            <span className="text-sm text-zinc-500">
              {fmtDay(r.startDate)} → {fmtDay(r.endDate)}
              {r.durationDays ? ` · ${r.durationDays} day${r.durationDays === 1 ? '' : 's'}` : ''}
            </span>
          </div>
          <div className="mt-1.5 text-base font-bold text-zinc-900 dark:text-zinc-100">{r.title}</div>
          {r.createdBy && <div className="mt-0.5 text-xs text-zinc-400">by {r.createdBy}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={r.status} />
          <button onClick={() => setOpen(!open)} className="px-3 py-1.5 text-xs font-bold rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {open ? 'Close' : 'Log results'}
          </button>
          {canDelete && (
            confirmDelete ? (
              <span className="inline-flex items-center gap-1.5">
                <button disabled={deleting} onClick={removeAd} className="px-3 py-1.5 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50 cursor-pointer border-0">
                  {deleting ? 'Deleting…' : 'Confirm'}
                </button>
                <button disabled={deleting} onClick={() => setConfirmDelete(false)} className="px-2.5 py-1.5 text-xs font-bold rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-500 cursor-pointer">
                  Keep
                </button>
              </span>
            ) : (
              <button onClick={() => { setErr(null); setConfirmDelete(true); }} className="px-3 py-1.5 text-xs font-bold rounded-xl border border-rose-500/40 text-rose-500 hover:bg-rose-500/10 cursor-pointer" title="Delete this campaign (MIS only)">
                Delete
              </button>
            )
          )}
        </div>
      </div>

      {/* Date progress */}
      {progress !== null && (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-1 text-[11px] font-semibold text-zinc-400">{progress}% of run window elapsed</div>
        </div>
      )}

      {/* KPI strip — always visible */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Spend', value: inr(r.amountSpent), tone: 'text-zinc-900 dark:text-white' },
          { label: 'Leads', value: int(r.leads), tone: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Enquiries', value: int(r.enquiries), tone: 'text-indigo-500' },
        ].map((k) => (
          <div key={k.label} className="rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800/70 px-3 py-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">{k.label}</div>
            <div className={`mt-0.5 text-lg font-extrabold tabular-nums ${k.tone}`}>{k.value}</div>
          </div>
        ))}
      </div>
      {cpl !== null && (
        <div className="text-xs text-zinc-500">Cost per lead: <b className="tabular-nums">{inr(cpl)}</b></div>
      )}

      {r.dataDescription && !open && (
        <div className="text-sm text-zinc-500 line-clamp-2">Data: {r.dataDescription}</div>
      )}
      {!open && r.attachments.length > 0 && (
        <div className="text-xs text-zinc-400">📎 {r.attachments.length} file{r.attachments.length === 1 ? '' : 's'} attached</div>
      )}

      {open && (
        <div className="space-y-3 border-t border-zinc-200 dark:border-zinc-800 pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={labelCls}>Amount spent (₹)
              <input type="number" min={0} value={spend} onChange={(e) => setSpend(e.target.value)} className={`${inputCls} mt-1.5`} />
            </label>
            <label className={labelCls}>Leads generated
              <input type="number" min={0} value={leads} onChange={(e) => setLeads(e.target.value)} className={`${inputCls} mt-1.5`} />
            </label>
            <label className={labelCls}>Enquiries generated
              <input type="number" min={0} value={enquiries} onChange={(e) => setEnquiries(e.target.value)} className={`${inputCls} mt-1.5`} />
            </label>
          </div>
          <label className={`block ${labelCls}`}>Data used — description
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} className={`${inputCls} mt-1.5`} />
          </label>
          <label className={`block ${labelCls}`}>Status
            <select value={status} onChange={(e) => setStatus(e.target.value as AdStatus)} className={`${inputCls} mt-1.5 max-w-[240px]`}>
              <option value="planned">○ planned</option>
              <option value="live">● live</option>
              <option value="completed">✓ completed</option>
            </select>
            <span className="block mt-1 font-normal text-zinc-400">Runs flip to completed automatically the day after the end date.</span>
          </label>
          <div className={labelCls}>
            Data files ({r.attachments.length})
            <div className="mt-2 space-y-1.5">
              {r.attachments.map((f) => (
                <div key={f.id} className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm">
                  <a href={f.url} target="_blank" rel="noreferrer" className="flex-1 truncate underline">📎 {f.fileName}</a>
                  <span className="text-xs text-zinc-400 shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                  <button onClick={() => removeFile(f.id)} className="text-rose-500 cursor-pointer border-0 bg-transparent text-base leading-none" title="Remove">✕</button>
                </div>
              ))}
              <label className="block">
                <span className="text-sm text-indigo-500 underline cursor-pointer">{uploading ? 'Uploading…' : '+ attach file'}</span>
                <input type="file" className="hidden" disabled={uploading} onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            </div>
          </div>
          {err && <div className="text-sm text-rose-500">{err}</div>}
          <div className="flex justify-end">
            <button disabled={busy} onClick={save} className="px-4 py-2 text-sm font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 cursor-pointer border-0">
              {busy ? 'Saving…' : 'Save results'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DigitalMarketingAds() {
  const { me } = useAuth();
  const canDelete = !!me && ((me as any).isAdmin || ((me as any).scopes ?? []).includes('mis'));
  const [typeFilter, setTypeFilter] = useState<'all' | AdType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | AdStatus>('all');
  const [query, setQuery] = useState('');
  const [showNew, setShowNew] = useState(false);
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
