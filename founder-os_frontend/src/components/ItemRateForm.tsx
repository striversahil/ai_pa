"use client";

import React, { useState } from "react";
import type { EnquiryItemRate, EnquiryMedia } from "@/types";
import { parseMoneyInput } from "@/types";
import { filesToMedia } from "@/lib/imageFiles";

interface ItemRateFormProps {
  onAdd: (rate: EnquiryItemRate) => void;
  /** Edit mode: prefill + relabel the submit button. */
  initial?: EnquiryItemRate;
  submitLabel?: string;
  onCancel?: () => void;
}

/** Standalone vendor-rate entry form (same fields + validation as the
 *  SpecificationsSection inline form): vendor name/address textarea,
 *  description textarea, rate input, spec same/different selector with a
 *  conditional differing-spec box. Vendor + valid non-negative rate required. */
export default function ItemRateForm({ onAdd, initial, submitLabel = "Add rate", onCancel }: ItemRateFormProps) {
  const [vendor, setVendor] = useState(initial?.vendor ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [salesNote, setSalesNote] = useState(initial?.salesNote ?? "");
  const [rate, setRate] = useState(initial?.rate !== undefined ? String(initial.rate) : "");
  const [discount, setDiscount] = useState(initial?.discountPercent !== undefined ? String(initial.discountPercent) : "");
  const [specMode, setSpecMode] = useState<"same" | "diff">(initial?.specSame === false ? "diff" : "same");
  const [specDiff, setSpecDiff] = useState(initial?.specDiff ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  // Per-vendor reference attachments (photos/drawings/PDFs for THIS quote).
  const [refs, setRefs] = useState<EnquiryMedia[]>(() => [...(initial?.references ?? [])]);
  const [refError, setRefError] = useState<string | null>(null);

  const attachRefs = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setRefError(null);
    const { media, skipped } = await filesToMedia(files);
    if (skipped.length > 0) setRefError(`Skipped: ${skipped.join(", ")}`);
    if (media.length > 0) setRefs((prev) => [...prev, ...media]);
  };

  const submit = () => {
    const v = vendor.trim();
    const r = parseMoneyInput(rate);
    if (!v) {
      setFormError("Enter the vendor name & address.");
      return;
    }
    if (r === null) {
      setFormError(`"${rate.trim()}" is not a valid amount — use digits only (e.g. 1200 or 1200.50).`);
      return;
    }
    let disc: number | undefined = undefined;
    if (String(discount).trim() !== "") {
      const n = Number(String(discount).trim());
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        setFormError("Discount must be 0–100%");
        return;
      }
      disc = Math.round(n * 100) / 100;
    }
    setFormError(null);
    const same = specMode !== "diff";
    onAdd({
      vendor: v,
      rate: r,
      discountPercent: disc,
      description: description.trim() || undefined,
      salesNote: salesNote.trim() || undefined,
      specSame: same,
      specDiff: !same && specDiff.trim() ? specDiff.trim() : undefined,
      // Reference attachments ride with the quote (add + edit alike).
      references: refs.length > 0 ? refs : undefined,
      quotedAt: initial?.quotedAt ?? new Date().toISOString(),
    });
    if (initial) return; // edit mode: parent closes the form
    setVendor("");
    setDescription("");
    setSalesNote("");
    setRate("");
    setDiscount("");
    setSpecMode("same");
    setSpecDiff("");
  };

  return (
    <div className="space-y-1.5 pt-1 rounded-lg border border-dashed border-[var(--border-card)] p-2">
      <textarea
        value={vendor}
        onChange={(e) => setVendor(e.target.value)}
        placeholder="Vendor name & address…"
        rows={2}
        className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs resize-y text-[var(--text-primary)]"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Vendor description — contact person, terms, delivery… (internal, not shown to sales)"
        rows={2}
        className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs resize-y text-[var(--text-primary)]"
      />
      <textarea
        value={salesNote}
        onChange={(e) => setSalesNote(e.target.value)}
        placeholder="Note for sales — forwarded to sales team when this vendor is selected (e.g. warranty, delivery for customer)…"
        rows={2}
        className="w-full px-2.5 py-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg outline-none focus:border-emerald-500 text-xs resize-y text-[var(--text-primary)]"
      />
      <div className="flex items-center gap-1.5">
        <input
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder="Rate ₹"
          inputMode="decimal"
          className="flex-1 px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
        />
        <input
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          placeholder="Disc. %"
          inputMode="decimal"
          className="w-20 px-2 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
        />
        <div className="flex rounded-lg border border-[var(--border-card)] overflow-hidden text-[11px] font-bold">
          <button type="button"
            onClick={() => setSpecMode("same")}
            className={`px-2.5 py-2 cursor-pointer border-0 ${specMode === "same" ? "bg-brand-indigo text-white" : "bg-transparent text-[var(--text-secondary)]"}`}>
            Spec same
          </button>
          <button type="button"
            onClick={() => setSpecMode("diff")}
            className={`px-2.5 py-2 cursor-pointer border-0 ${specMode === "diff" ? "bg-amber-500 text-white" : "bg-transparent text-[var(--text-secondary)]"}`}>
            Spec different
          </button>
        </div>
        <button type="button" onClick={submit}
          className="px-3 py-2 bg-brand-indigo/10 text-brand-indigo hover:bg-brand-indigo/20 font-bold text-[11px] rounded-lg cursor-pointer border-0 whitespace-nowrap">
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="px-3 py-2 font-bold text-[11px] rounded-lg cursor-pointer border-0 bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] whitespace-nowrap">
            Cancel
          </button>
        )}
      </div>
      {formError && (
        <p className="text-[11px] font-bold text-red-500">{formError}</p>
      )}
      {specMode === "diff" && (
        <textarea
          value={specDiff}
          onChange={(e) => setSpecDiff(e.target.value)}
          placeholder="Log the vendor's differing spec here…"
          rows={2}
          className="w-full px-2.5 py-2 bg-amber-500/5 border border-amber-500/30 rounded-lg outline-none focus:border-amber-500 text-xs resize-y text-[var(--text-primary)]"
        />
      )}
      {refs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {refs.map((m, mi) => (
            <div key={mi} className="relative flex-shrink-0">
              {m.type === "video" ? (
                <video src={m.url} controls preload="metadata" className="w-20 h-12 rounded-lg object-cover border border-[var(--border-card)] bg-black" />
              ) : m.type === "pdf" ? (
                <span className="block px-2 py-1.5 rounded-lg border border-[var(--border-card)] bg-red-500/10 text-[10px] font-bold text-[var(--text-primary)] truncate max-w-[8rem]">
                  {m.name || "PDF"}
                </span>
              ) : (
                <img src={m.url} alt={`Reference ${mi + 1}`} className="w-12 h-12 rounded-lg object-cover border border-[var(--border-card)]" />
              )}
              <button type="button" onClick={() => setRefs((prev) => prev.filter((_, j) => j !== mi))} title="Remove reference"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] font-bold cursor-pointer border border-white/20">×</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-indigo hover:opacity-80 cursor-pointer">
          + Reference
          <input type="file" multiple accept="image/*,video/*,.pdf,application/pdf" className="hidden"
            onChange={(e) => { void attachRefs(e.target.files); e.target.value = ""; }} />
        </label>
        <span className="text-[10px] text-[var(--text-tertiary)]">photos / drawings / PDF for this vendor's quote</span>
      </div>
      {refError && (
        <p className="text-[11px] font-bold text-red-500">{refError}</p>
      )}
    </div>
  );
}
