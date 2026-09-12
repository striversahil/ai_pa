"use client";

import React, { useState, useMemo } from "react";
import { EnquiryItem, EnquiryMedia } from "../mockData";
import ToggleSwitch from "./ToggleSwitch";

/** ~10MB per item file (stored as data-URI on the item; server re-checks). */
const MAX_ITEM_FILE_BYTES = 10 * 1024 * 1024;

const itemMediaKind = (f: File): EnquiryMedia["type"] =>
  f.type.startsWith("video/") ? "video" : (f.type === "application/pdf" || /\.pdf$/i.test(f.name) ? "pdf" : "image");

export const blankItem = (): EnquiryItem => ({ name: "", qty: "", spec: "", media: [] });

/** One pasted requirement block: first non-QTY line is the name, a
 *  QTY-prefixed line is the qty, any extra lines join into the spec. */
export interface ParsedRequirement { name: string; qty: string; spec: string; }

/** Trailing count-units that are safe to read as qty (`- 50 PCS`); size
 *  specs (`- 20 INCH`, `- 24 TEETH`) are deliberately NOT on this list. */
const COUNT_UNIT_RE = /^(.*?)[\-–—]\s*(\d+(?:\.\d+)?\s*(?:pcs?|nos?|sets?|box(?:es)?|pkts?|pairs?))$/i;

/** Split pasted requirements on blank lines — each block becomes one item.
 *  A line like `QTY - 3 PCS` / `QTY: 3 PCS` / `QTY 3 PCS` (any case) is
 *  captured as the qty; every other line belongs to name/spec. */
export function parseRequirementBlocks(text: string): ParsedRequirement[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      let qty = "";
      const rest: string[] = [];
      for (const line of lines) {
        const m = line.match(/^qty\s*[:\-–—]?\s*(.+)$/i);
        if (m && !qty) qty = m[1].trim();
        else rest.push(line);
      }
      // No explicit QTY line: a trailing count-unit (`COTTON PAD - 50 PCS`)
      // still reads as qty. Anything else defaults to 1.
      if (!qty && rest.length > 0) {
        const t = rest[0].match(COUNT_UNIT_RE);
        if (t && t[1].trim()) {
          rest[0] = t[1].trim();
          qty = t[2].trim();
        }
      }
      return { name: rest[0] ?? "", qty: qty || "1", spec: rest.slice(1).join("\n") };
    })
    .filter((p) => p.name || p.qty || p.spec);
}
/** Qty keeps digits + units (`3 PCS`): strips only characters that can
 *  never belong in a quantity, collapses stray whitespace. */
export const cleanQty = (v: string): string => {
  const s = String(v ?? "").replace(/[^0-9a-zA-Z .\-/]/g, "").replace(/\s+/g, " ").trim();
  return s.slice(0, 120);
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
  // Bulk requirement paste: blank line starts a new item, parsed live.
  const [bulkText, setBulkText] = useState("");
  const bulkParsed = useMemo(() => parseRequirementBlocks(bulkText), [bulkText]);

  const addBulkItems = () => {
    if (bulkParsed.length === 0) return;
    onChange([
      ...items,
      ...bulkParsed.map((p) => ({ name: p.name, qty: p.qty, spec: p.spec, media: [] as EnquiryMedia[] })),
    ]);
    setBulkText("");
  };

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
              placeholder="Qty (e.g. 3 PCS)"
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
      <div className="rounded-xl border border-dashed border-[var(--border-card)] p-3 space-y-2 bg-[var(--bg-input)]/20">
        <label className="block text-sm md:text-base font-extrabold text-[var(--text-primary)]">
          📋 Add requirements
          <span className="mt-0.5 block text-xs font-semibold text-[var(--text-secondary)]">Paste items below — a blank line starts a new item, a QTY line sets its quantity</span>
        </label>
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          rows={10}
          placeholder={"ROLL PREMIUM - 20 INCH\nQTY - 3 PCS\n\nCOTTON PAD - 50 PCS\n\nHOUSING PIN - 24 TEETH\nQTY - 1"}
          className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs resize-y text-[var(--text-primary)] font-mono"
        />
        <div className="flex items-center gap-2">
          <button type="button" onClick={addBulkItems} disabled={bulkParsed.length === 0}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-brand-indigo hover:opacity-90 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-indigo-600/20 transition-all cursor-pointer border-0 disabled:opacity-40">
            Add {bulkParsed.length > 0 ? `${bulkParsed.length} ` : ""}item{bulkParsed.length === 1 ? "" : "s"}
          </button>
          {bulkText.trim() && (
            <span className={`text-[11px] font-bold ${bulkParsed.length > 0 ? "text-emerald-500" : "text-[var(--text-tertiary)]"}`}>
              {bulkParsed.length > 0 ? `${bulkParsed.length} item${bulkParsed.length === 1 ? "" : "s"} detected` : "Type items separated by a blank line"}
            </span>
          )}
        </div>
      </div>
      {fileError && <p className="text-[11px] font-semibold text-[var(--color-danger)]">{fileError}</p>}
    </div>
  );
}
