"use client";

import React, { useState } from "react";
import type { EnquiryItemRate } from "@/types";
import { parseMoneyInput } from "@/types";

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
  const [rate, setRate] = useState(initial?.rate !== undefined ? String(initial.rate) : "");
  const [specMode, setSpecMode] = useState<"same" | "diff">(initial?.specSame === false ? "diff" : "same");
  const [specDiff, setSpecDiff] = useState(initial?.specDiff ?? "");

  const submit = () => {
    const v = vendor.trim();
    const r = parseMoneyInput(rate);
    if (!v || r === null) return;
    const same = specMode !== "diff";
    onAdd({
      vendor: v,
      rate: r,
      description: description.trim() || undefined,
      specSame: same,
      specDiff: !same && specDiff.trim() ? specDiff.trim() : undefined,
      quotedAt: initial?.quotedAt ?? new Date().toISOString(),
    });
    if (initial) return; // edit mode: parent closes the form
    setVendor("");
    setDescription("");
    setRate("");
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
        placeholder="Vendor description — contact person, terms, delivery…"
        rows={2}
        className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs resize-y text-[var(--text-primary)]"
      />
      <div className="flex items-center gap-1.5">
        <input
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder="Rate ₹"
          inputMode="decimal"
          className="flex-1 px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
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
      {specMode === "diff" && (
        <textarea
          value={specDiff}
          onChange={(e) => setSpecDiff(e.target.value)}
          placeholder="Log the vendor's differing spec here…"
          rows={2}
          className="w-full px-2.5 py-2 bg-amber-500/5 border border-amber-500/30 rounded-lg outline-none focus:border-amber-500 text-xs resize-y text-[var(--text-primary)]"
        />
      )}
    </div>
  );
}
