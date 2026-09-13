"use client";

import React, { useState } from "react";
import type { IntakeSuggestion } from "@/hooks/useIntake";

interface IntakeItemMetaProps {
  itemIndex: number;
  suggestions: IntakeSuggestion[];
  missing: string[];
  /** Present in sales view: 1-click quote-from-memory (rateAvailable). */
  onAccept?: (itemIndex: number) => Promise<void> | void;
}

/** Per-item AI intake strip: missing-detail chips + past-price cards.
 *  Lives inside each item row (SpecificationsSection). */
export default function IntakeItemMeta({ itemIndex, suggestions, missing, onAccept }: IntakeItemMetaProps) {
  const [busy, setBusy] = useState(false);
  const mine = (suggestions ?? []).filter((s) => Number(s.itemIndex ?? -1) === itemIndex);
  if (mine.length === 0 && missing.length === 0) return null;

  const accept = async (idx: number) => {
    if (!onAccept || busy) return;
    setBusy(true);
    try {
      await onAccept(idx);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1.5 space-y-1.5">
      {missing.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {missing.map((m, i) => (
            <span key={i} className="px-1.5 py-px text-[10px] font-bold rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
              {m}
            </span>
          ))}
        </div>
      )}
      {mine.map((s, i) => (
        <div key={`${s.memoryId ?? i}`} className="flex items-center justify-between gap-2 rounded-lg border border-indigo-500/25 bg-indigo-500/5 px-2 py-1.5">
          <span className="text-[11px]">
            <span className={`inline-block px-1.5 py-px text-[10px] font-extrabold uppercase rounded mr-1.5 ${s.route === "exact" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-sky-500/15 text-sky-600 dark:text-sky-400"}`}>
              {s.route === "exact" ? "Past price" : "Similar"}
            </span>
            <span className="font-semibold text-[var(--text-primary)]">{s.name || "Past quote"}</span>
            {s.finalRate !== undefined && s.finalRate !== null && (
              <span className="ml-1.5 font-bold text-[var(--text-primary)]">₹{Number(s.finalRate).toLocaleString("en-IN")}</span>
            )}
            {typeof s.score === "number" && (
              <span className="ml-1.5 text-[var(--text-tertiary)]">{Math.round(s.score * 100)}%</span>
            )}
          </span>
          {onAccept && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void accept(itemIndex)}
              className="shrink-0 px-2 py-0.5 text-[11px] font-bold rounded-lg bg-indigo-500 text-white hover:opacity-90 disabled:opacity-50 cursor-pointer border-0"
            >
              {busy ? "…" : s.route === "exact" ? "Quote this" : "Use as ref"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
