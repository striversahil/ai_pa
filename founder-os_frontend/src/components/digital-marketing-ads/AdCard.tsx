"use client";

// Extracted verbatim from DigitalMarketingAds.tsx by scripts/refactor/split-module.mjs.
// DigitalMarketingAds.tsx re-exports everything public here, so existing imports keep working.
import React, { useState } from "react";
import type { AdRow, AdStatus } from "./types";
import { dateProgress, uploadAdFile, TYPE_META, fmtDay, inr, int, labelCls, inputCls } from "./helpers";
import { StatusPill } from "./StatusPill";

export function AdCard({ r, onChanged, canDelete }: { r: AdRow; onChanged: () => void; canDelete: boolean }) {
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
