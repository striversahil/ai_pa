"use client";

import React, { useState } from "react";
import { EnquiryItem, EnquiryMedia } from "../mockData";
import ToggleSwitch from "./ToggleSwitch";

/** ~10MB per item file (stored as data-URI on the item; server re-checks). */
const MAX_ITEM_FILE_BYTES = 10 * 1024 * 1024;

const itemMediaKind = (f: File): EnquiryMedia["type"] =>
  f.type.startsWith("video/") ? "video" : (f.type === "application/pdf" || /\.pdf$/i.test(f.name) ? "pdf" : "image");

export const blankItem = (): EnquiryItem => ({ name: "", qty: "", spec: "", media: [] });

/** Numeric-only qty: digits with a single optional decimal point. */
export const cleanQty = (v: string): string => {
  const s = String(v ?? "").replace(/[^0-9.]/g, "");
  const i = s.indexOf(".");
  return i === -1 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "");
};

/** Duplicate an item for fast multi-entry: copies identity + media, resets
 *  the rate workflow (fresh item needs its own rates/decision). */
export const duplicateItem = (src: EnquiryItem): EnquiryItem => ({
  name: src.name,
  qty: src.qty,
  spec: src.spec,
  media: [...(src.media ?? [])],
  rates: [],
  rateAvailable: src.rateAvailable,
});

interface ItemBoxListProps {
  items: EnquiryItem[];
  onChange: (items: EnquiryItem[]) => void;
  showRateToggle?: boolean;
}

// Shared multi-item editor: the SAME boxes in the B2B enquiry form and the
// detail-view "Add Items" flow — textarea name, numeric qty, duplicate,
// per-item attachments.
export default function ItemBoxList({ items, onChange, showRateToggle = true }: ItemBoxListProps) {
  const [fileError, setFileError] = useState<string | null>(null);

  const updateItem = (idx: number, patch: Partial<EnquiryItem>) =>
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const removeItem = (idx: number) =>
    onChange(items.filter((_, i) => i !== idx));

  const copyItem = (idx: number) =>
    onChange([...items.slice(0, idx + 1), duplicateItem(items[idx]), ...items.slice(idx + 1)]);

  const addItemFiles = (idx: number, files: FileList | null) => {
    if (!files || files.length === 0) return;
    setFileError(null);
    const accepted = Array.from(files).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/") || f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    const tooBig = Array.from(files).find((f) => f.size > MAX_ITEM_FILE_BYTES);
    if (tooBig) setFileError(`"${tooBig.name}" exceeds 10MB and was skipped.`);
    const todo = accepted.filter((f) => f.size <= MAX_ITEM_FILE_BYTES);
    if (todo.length === 0) return;
    const loaded: EnquiryMedia[] = [];
    let processed = 0;
    todo.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) loaded.push({ type: itemMediaKind(file), url: evt.target.result as string, name: file.name });
        processed++;
        if (processed === todo.length) {
          onChange(items.map((it, i) => (i === idx ? { ...it, media: [...(it.media ?? []), ...loaded] } : it)));
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeItemFile = (idx: number, mediaIdx: number) =>
    onChange(items.map((it, i) => (i === idx ? { ...it, media: (it.media ?? []).filter((_, j) => j !== mediaIdx) } : it)));

  return (
    <div className="space-y-2">
      {items.map((it, idx) => (
        <div key={idx} className="p-3 rounded-xl border border-[var(--border-card)]/60 bg-[var(--bg-input)]/25 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold text-[var(--text-primary)]">Item {idx + 1}</span>
            <span className="flex items-center gap-2">
              <button type="button" onClick={() => copyItem(idx)}
                className="text-[11px] font-bold text-brand-indigo hover:opacity-80 cursor-pointer bg-transparent border-0">
                Duplicate
              </button>
              <button type="button" onClick={() => removeItem(idx)}
                className="text-[11px] font-bold text-[var(--color-danger)] hover:opacity-80 cursor-pointer bg-transparent border-0">
                Remove
              </button>
            </span>
          </div>
          <textarea
            value={it.name}
            onChange={(e) => updateItem(idx, { name: e.target.value })}
            placeholder="Item name (e.g. Conveyor Belt Fastener)"
            rows={2}
            className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs resize-y text-[var(--text-primary)]"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={it.qty}
              onChange={(e) => updateItem(idx, { qty: cleanQty(e.target.value) })}
              placeholder="Qty (e.g. 1000)"
              inputMode="decimal"
              className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
            />
            <input
              value={it.spec}
              onChange={(e) => updateItem(idx, { spec: e.target.value })}
              placeholder="Spec (e.g. 24GG 1 mtr)"
              className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
            />
          </div>
          {(it.media ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(it.media ?? []).map((m, mi) => (
                <div key={mi} className="relative flex-shrink-0 group">
                  {m.type === "video" ? (
                    <video src={m.url} controls preload="metadata" className="w-24 h-16 rounded-lg object-cover border border-[var(--border-card)] bg-black" />
                  ) : m.type === "pdf" ? (
                    <span className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-[var(--border-card)] bg-red-500/10 text-[10px] font-bold text-[var(--text-primary)] max-w-[10rem]">
                      <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      <span className="truncate">{m.name || "PDF"}</span>
                    </span>
                  ) : (
                    <img src={m.url} alt={`Item ${idx + 1} file ${mi + 1}`} className="w-14 h-14 rounded-lg object-cover border border-[var(--border-card)]" />
                  )}
                  <button type="button" onClick={() => removeItemFile(idx, mi)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] font-bold cursor-pointer border border-white/20">×</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-3 pt-1.5">
            <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-brand-indigo hover:opacity-80 cursor-pointer">
              + Add attachment
              <input type="file" multiple accept="image/*,video/*,.pdf,application/pdf" className="hidden"
                onChange={(e) => { addItemFiles(idx, e.target.files); e.target.value = ""; }} />
            </label>
            {showRateToggle && (
              <ToggleSwitch
                checked={it.rateAvailable === true}
                onChange={(next) => updateItem(idx, { rateAvailable: next })}
                label="Rate available"
              />
            )}
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, blankItem()])}
        className="mx-auto flex items-center justify-center gap-2 w-full max-w-xs px-6 py-3.5 bg-brand-indigo hover:opacity-90 text-white font-extrabold text-sm rounded-xl shadow-lg shadow-indigo-600/20 transition-all cursor-pointer border-0">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add Item
      </button>
      {fileError && <p className="text-[11px] font-semibold text-[var(--color-danger)]">{fileError}</p>}
    </div>
  );
}
