"use client";

// Extracted verbatim from DigitalMarketingAds.tsx by scripts/refactor/split-module.mjs.
// DigitalMarketingAds.tsx re-exports everything public here, so existing imports keep working.
import { useState } from "react";
import type { AdType } from "./types";
import { uploadAdFile, labelCls, inputCls, TYPE_META } from "./helpers";

export function NewAdRunModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
