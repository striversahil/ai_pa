'use client';
// DigitalMarketingOpenTasks — Open Tasks tab: free-form tasks with start/end +
// per-day progress (migration 0120). Overhauled UI: full-width readable cards,
// progress bar, recent-notes preview, large day cells, image proof thumbnails.
// Mirror: backend src/automations/digital-marketing/open-tasks.ts.
import React, { useMemo, useState } from 'react';
import { useLiveDashboard } from '@/hooks/useLiveData';
import { useAuth } from '@/auth/AuthContext';
import { fmtDayYear as fmtDay } from "@/lib/format";

interface Attachment { id: string; entryId: string | null; fileName: string; mime: string; size: number; uploadedBy: string; createdAt: string; url: string; }
interface Entry { id: string; date: string; note: string; updatedBy: string; createdAt: string; updatedAt: string; attachments: Attachment[]; }
interface Row { id: string; title: string; description: string; startDate: string; endDate: string; durationDays: number | null; status: 'open' | 'done'; doneAt: string | null; createdBy: string | null; createdAt: string; updatedAt: string; entries: Entry[]; attachments: Attachment[]; }
interface Payload { rows: Row[]; total: number; generatedAt: string; }

const inputCls = 'w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500';
const labelCls = 'text-xs font-bold text-zinc-600 dark:text-zinc-300';


function fmtDayNum(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? String(Number(m[3])) : '·';
}
function fmtMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return m ? (MO[Number(m[2]) - 1] ?? '') : '';
}
function istToday(): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).slice(0, 10); } catch { return new Date().toISOString().slice(0, 10); }
}
function dayRange(start: string, end: string, cap = 120): { days: string[]; truncated: boolean } {
  const out: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return { days: out, truncated: false };
  let d = start;
  while (d <= end && out.length < cap) { out.push(d); const t = Date.parse(d) + 86400000; d = new Date(t).toISOString().slice(0, 10); }
  return { days: out, truncated: end > (out[out.length - 1] ?? end) };
}
async function uploadFile(url: string, file: File): Promise<void> {
  const form = new FormData(); form.append('file', file);
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) throw new Error(await res.text());
}
function isImage(a: Attachment): boolean {
  return /^image\//.test(a.mime || '') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.fileName || '');
}

function NewOpenTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(''); const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setErr(null);
    if (!title.trim()) { setErr('Title required'); return; }
    if (!startDate || !endDate) { setErr('Start + end dates required'); return; }
    if (endDate < startDate) { setErr('End date must be on or after start date'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/digital-marketing/open-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim(), description: description.trim(), startDate, endDate }) });
      if (!res.ok) throw new Error(await res.text());
      onCreated();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Create failed'); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 space-y-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-extrabold">🗂️ New open task</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title — e.g. Diwali catalogue shoot" className={inputCls} />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional) — scope, links, references" rows={4} className={inputCls} />
        <div className="grid grid-cols-2 gap-3">
          <label className={labelCls}>Start<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`${inputCls} mt-1.5`} /></label>
          <label className={labelCls}>End<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={`${inputCls} mt-1.5`} /></label>
        </div>
        {err && <div className="text-sm text-rose-500 font-semibold">{err}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-500 cursor-pointer">Cancel</button>
          <button disabled={busy} onClick={submit} className="px-4 py-2 text-sm font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 cursor-pointer border-0">{busy ? 'Creating…' : 'Create task'}</button>
        </div>
      </div>
    </div>
  );
}

function FileThumb({ a, onRemove }: { a: Attachment; onRemove: (id: string) => void }) {
  if (isImage(a)) {
    return (
      <span className="group relative inline-block overflow-hidden rounded-xl border border-zinc-300 dark:border-zinc-700">
        <a href={a.url} target="_blank" rel="noreferrer" title={a.fileName}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.url} alt={a.fileName} className="h-20 w-20 object-cover" loading="lazy" />
        </a>
        <button onClick={() => onRemove(a.id)} className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[11px] font-bold text-white cursor-pointer border-0 opacity-0 group-hover:opacity-100" title={`Remove ${a.fileName}`}>✕</button>
        <span className="block max-w-[80px] truncate bg-zinc-50 dark:bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-500">{a.fileName}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex max-w-[220px] items-center gap-1.5 rounded-xl border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-600 dark:text-zinc-300">
      <a href={a.url} target="_blank" rel="noreferrer" className="underline truncate">📎 {a.fileName}</a>
      <button onClick={() => onRemove(a.id)} className="font-bold text-rose-500 cursor-pointer border-0 bg-transparent" title="Remove">✕</button>
    </span>
  );
}

function DayEditor({ taskId, date, entry, onSaved }: { taskId: string; date: string; entry?: Entry; onSaved: () => void }) {
  const [note, setNote] = useState(entry?.note ?? '');
  const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false); const [err, setErr] = useState<string | null>(null);
  React.useEffect(() => { setNote(entry?.note ?? ''); }, [entry?.id, date]);
  const save = async () => {
    setErr(null); setBusy(true);
    try {
      const res = await fetch(`/api/digital-marketing/open-tasks/${encodeURIComponent(taskId)}/entries`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, note }) });
      if (!res.ok) throw new Error(await res.text());
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed'); } finally { setBusy(false); }
  };
  const attach = async (f: File) => {
    setErr(null); setUploading(true);
    try { await uploadFile(`/api/digital-marketing/open-tasks/${encodeURIComponent(taskId)}/entries/${encodeURIComponent(date)}/files`, f); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Upload failed'); } finally { setUploading(false); }
  };
  const removeFile = async (id: string) => {
    try { const res = await fetch(`/api/digital-marketing/open-tasks/files/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (!res.ok) throw new Error(await res.text()); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Remove failed'); }
  };
  const dirty = note !== (entry?.note ?? '');
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-extrabold text-zinc-700 dark:text-zinc-200">📅 {fmtDay(date)}{entry ? <span className="ml-2 text-xs font-medium text-emerald-500">· logged{entry.updatedBy ? ` by ${entry.updatedBy}` : ''}</span> : <span className="ml-2 text-xs font-medium text-zinc-400">· not yet logged</span>}</div>
        <button disabled={busy} onClick={save} className={`px-4 py-1.5 text-xs font-bold rounded-xl cursor-pointer border-0 ${dirty ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500'}`}>{busy ? 'Saving…' : 'Save day'}</button>
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={`What got done on ${fmtDay(date)}?`} rows={5} className={inputCls} />
      {(entry?.attachments ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(entry?.attachments ?? []).map((a) => <FileThumb key={a.id} a={a} onRemove={removeFile} />)}
        </div>
      )}
      <label className={`block ${labelCls}`}>Daily proof <span className="font-medium text-zinc-400">(images / pdf — images show as thumbnails)</span>
        <input type="file" accept="image/*,.pdf" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void attach(f); }} className="mt-1.5 block w-full text-sm text-zinc-500" />
      </label>
      {uploading && <div className="text-xs text-zinc-400 animate-pulse">Uploading…</div>}
      {err && <div className="text-sm text-rose-500 font-semibold">{err}</div>}
    </div>
  );
}

function OpenTaskCard({ r, onChanged, canDelete }: { r: Row; onChanged: () => void; canDelete: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false); const [deleting, setDeleting] = useState(false);
  const { days, truncated } = useMemo(() => dayRange(r.startDate, r.endDate), [r.startDate, r.endDate]);
  const today = istToday();
  const [sel, setSel] = useState(today >= r.startDate && today <= r.endDate ? today : r.startDate);
  const entryByDate = useMemo(() => new Map((r.entries ?? []).map((e) => [e.date, e])), [r.entries]);
  const logged = (r.entries ?? []).length;
  const pct = days.length ? Math.round((logged / days.length) * 100) : 0;
  const recent = useMemo(() => [...(r.entries ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3), [r.entries]);

  const toggleDone = async () => {
    setErr(null); setBusy(true);
    try {
      const res = await fetch(`/api/digital-marketing/open-tasks/${encodeURIComponent(r.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: r.status === 'done' ? 'open' : 'done' }) });
      if (!res.ok) throw new Error(await res.text());
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Update failed'); } finally { setBusy(false); }
  };
  const removeTask = async () => {
    setErr(null); setDeleting(true);
    try {
      const res = await fetch(`/api/digital-marketing/open-tasks/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Delete failed'); setDeleting(false); setConfirmDelete(false); }
  };
  const attachTaskFile = async (f: File) => {
    setErr(null); setUploading(true);
    try { await uploadFile(`/api/digital-marketing/open-tasks/${encodeURIComponent(r.id)}/files`, f); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Upload failed'); } finally { setUploading(false); }
  };
  const removeFile = async (id: string) => {
    try { const res = await fetch(`/api/digital-marketing/open-tasks/files/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (!res.ok) throw new Error(await res.text()); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Remove failed'); }
  };

  return (
    <div className={`rounded-2xl border p-5 shadow-sm space-y-4 ${r.status === 'done' ? 'border-emerald-500/40 bg-emerald-500/[0.04]' : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950'}`}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold text-zinc-900 dark:text-white">{r.title}</div>
          <div className="mt-1 text-sm text-zinc-500">{fmtDay(r.startDate)} → {fmtDay(r.endDate)}{r.durationDays ? ` · ${r.durationDays} days` : ''} · <b className={logged === days.length && days.length > 0 ? 'text-emerald-500' : ''}>{logged}/{days.length || '—'} days logged</b>{r.createdBy ? ` · by ${r.createdBy}` : ''}</div>
          {r.description && <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">{r.description}</div>}
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-extrabold ${r.status === 'done' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-indigo-500/15 text-indigo-400'}`}>{r.status === 'done' ? '✓ done' : '○ open'}</span>
      </div>

      {/* Progress */}
      <div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div className={`h-full rounded-full transition-all ${r.status === 'done' ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${r.status === 'done' ? 100 : pct}%` }} />
        </div>
        <div className="mt-1 text-[11px] font-semibold text-zinc-400">{r.status === 'done' ? 'Completed' : `${pct}% days logged`}</div>
      </div>

      {/* Recent notes preview — visible without opening */}
      {recent.length > 0 && !open && (
        <div className="space-y-1.5 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800/70 p-3">
          {recent.map((e) => (
            <div key={e.id} className="text-sm text-zinc-600 dark:text-zinc-300">
              <span className="font-bold">{fmtDay(e.date)}</span>
              <span className="text-zinc-400"> — </span>
              <span className="line-clamp-1 inline">{e.note || <span className="text-zinc-400 italic">(no note, files only)</span>}{e.attachments.length > 0 && <span className="text-zinc-400"> 📎×{e.attachments.length}</span>}</span>
            </div>
          ))}
        </div>
      )}

      {/* Task-level files preview */}
      {(r.attachments ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {r.attachments.map((a) => <FileThumb key={a.id} a={a} onRemove={removeFile} />)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setOpen(!open)} className="px-3.5 py-1.5 text-sm font-bold rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800">{open ? 'Close' : `Daily progress (${logged})`}</button>
        <button disabled={busy} onClick={toggleDone} className="px-3.5 py-1.5 text-sm font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 cursor-pointer border-0">{r.status === 'done' ? 'Reopen' : '✓ Mark done'}</button>
        {canDelete && (confirmDelete ? (
          <span className="inline-flex items-center gap-1.5">
            <button disabled={deleting} onClick={removeTask} className="px-3.5 py-1.5 text-sm font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50 cursor-pointer border-0">{deleting ? 'Deleting…' : 'Confirm delete'}</button>
            <button disabled={deleting} onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-sm font-bold rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-500 cursor-pointer">Keep</button>
          </span>
        ) : <button onClick={() => { setErr(null); setConfirmDelete(true); }} className="px-3.5 py-1.5 text-sm font-bold rounded-xl border border-rose-500/40 text-rose-500 hover:bg-rose-500/10 cursor-pointer" title="Delete this task">Delete</button>)}
      </div>
      {err && <div className="text-sm text-rose-500 font-semibold">{err}</div>}

      {open && (
        <div className="space-y-3 border-t border-zinc-200 dark:border-zinc-800 pt-4">
          <label className={`block ${labelCls}`}>Task files <span className="font-medium text-zinc-400">(brief, references)</span>
            <input type="file" accept="image/*,.pdf" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void attachTaskFile(f); }} className="mt-1.5 block w-full text-sm text-zinc-500" />
          </label>
          {days.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={sel} min={r.startDate} max={r.endDate} onChange={(e) => setSel(e.target.value)} className={`${inputCls} max-w-[190px]`} />
              <span className={`text-xs font-bold ${entryByDate.has(sel) ? 'text-emerald-500' : 'text-zinc-400'}`}>{entryByDate.has(sel) ? '● logged' : '○ pending'}</span>
            </div>
          )}
          {truncated && <div className="text-xs text-amber-500 font-semibold">Long range — showing first {days.length} days. Pick any date above outside this window.</div>}
          {/* Large day strip */}
          {days.length > 0 && days.length <= 62 && (
            <div className="flex flex-wrap gap-1.5">
              {days.map((d) => {
                const done = entryByDate.has(d);
                const active = d === sel;
                return (
                  <button key={d} onClick={() => setSel(d)} title={`${fmtDay(d)}${done ? ' · logged' : ''}`}
                    className={`flex h-12 w-11 flex-col items-center justify-center rounded-xl border cursor-pointer text-xs font-extrabold transition-all ${active ? 'border-indigo-500 ring-2 ring-indigo-500/40' : 'border-zinc-300 dark:border-zinc-700'} ${done ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-500'}`}>
                    <span className="text-sm leading-none">{fmtDayNum(d)}</span>
                    <span className="mt-0.5 text-[10px] font-bold leading-none opacity-70">{fmtMonth(d)}</span>
                    <span className={`mt-1 h-1.5 w-1.5 rounded-full ${done ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'}`} />
                  </button>
                );
              })}
            </div>
          )}
          {sel && <DayEditor key={sel} taskId={r.id} date={sel} entry={entryByDate.get(sel)} onSaved={onChanged} />}
        </div>
      )}
    </div>
  );
}

export default function DigitalMarketingOpenTasks() {
  const { me } = useAuth();
  const tasks = useLiveDashboard<Payload>(async () => {
    const res = await fetch('/api/digital-marketing/open-tasks', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Load failed (HTTP ${res.status})`);
    return res.json();
  }, { pollMs: 60000 });
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all');
  const meName = (me as any)?.user?.name ?? (me as any)?.user?.email ?? '';
  const canMIS = !!me && ((me as any).isAdmin || (((me as any).scopes ?? []) as string[]).includes('mis'));
  const rows = useMemo(() => {
    const all = tasks.data?.rows ?? [];
    return filter === 'all' ? all : all.filter((r) => r.status === filter);
  }, [tasks.data, filter]);
  const counts = useMemo(() => {
    const all = tasks.data?.rows ?? [];
    return {
      all: all.length,
      open: all.filter((r) => r.status === 'open').length,
      done: all.filter((r) => r.status === 'done').length,
      days: all.reduce((s, r) => s + (r.entries?.length ?? 0), 0),
    };
  }, [tasks.data]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">🗂️ Open tasks</h3>
          {tasks.data && <span className="text-xs text-zinc-500">○ {counts.open} open · ✓ {counts.done} done · {counts.days} days logged</span>}
        </div>
        <button onClick={() => setShowNew(true)} className="px-4 py-2 text-sm font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer border-0 shadow-sm">+ New task</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {([['all', `All (${counts.all})`], ['open', `○ Open (${counts.open})`], ['done', `✓ Done (${counts.done})`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={`px-3.5 py-1.5 text-xs font-bold rounded-full cursor-pointer border ${filter === k ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-transparent' : 'border-zinc-300 dark:border-zinc-700 text-zinc-500'}`}>{label}</button>
        ))}
      </div>
      {tasks.loading && !tasks.data && <div className="py-10 text-center text-sm text-zinc-500 animate-pulse">Loading open tasks…</div>}
      {Boolean((tasks as any).error) && !tasks.data && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-400">Failed to load: {String((tasks as any).error)} <button onClick={() => tasks.refresh()} className="ml-2 underline cursor-pointer">Retry</button></div>
      )}
      {tasks.data && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center text-sm text-zinc-500">No {filter === 'all' ? '' : filter + ' '}tasks yet — create the first one with + New task.</div>
      )}
      {rows.length > 0 && (
        <div className="grid gap-4">
          {rows.map((r) => <OpenTaskCard key={r.id} r={r} onChanged={() => tasks.refresh()} canDelete={canMIS || (!!meName && r.createdBy === meName)} />)}
        </div>
      )}
      {showNew && <NewOpenTaskModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); tasks.refresh(); }} />}
    </div>
  );
}
