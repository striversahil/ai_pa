"use client";

import React, { useEffect, useState } from "react";

interface IntakeSuggestion {
  itemIndex: number;
  memoryId?: string;
  score?: number;
  name?: string;
  route?: string;
  finalRate?: number;
}

interface IntakePanelProps {
  enquiryId: string;
  onAccept: (itemIndex: number) => void;
  accepting: boolean;
}

/** AI intake panel (sales view): missing-detail prompts + past-price
 *  suggestions from price memory. Rendered inside EnquiryDetail. */
export default function IntakePanel({ enquiryId, onAccept, accepting }: IntakePanelProps) {
  const [data, setData] = useState<{ ready: boolean; suggestions: IntakeSuggestion[]; missing: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    fetch(`/api/enquiries/${enquiryId}/intake`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j) setData(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [enquiryId]);

  if (!data || !data.ready) return null;
  if (data.missing.length === 0 && data.suggestions.length === 0) return null;

  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-2">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-500">AI intake</p>
      {data.missing.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.missing.map((m, i) => (
            <span key={i} className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
              {m}
            </span>
          ))}
        </div>
      )}
      {data.suggestions.map((s, i) => (
        <div key={`${s.memoryId ?? i}`} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] px-2.5 py-2">
          <div className="text-xs">
            <span className={`inline-block px-1.5 py-0.5 text-[10px] font-extrabold uppercase rounded mr-1.5 ${s.route === "exact" ? "bg-emerald-500/15 text-emerald-600" : "bg-sky-500/15 text-sky-600"}`}>
              {s.route === "exact" ? "Past price" : "Similar"}
            </span>
            <span className="font-semibold">{s.name || `Item ${(s.itemIndex ?? 0) + 1}`}</span>
            {s.finalRate !== undefined && s.finalRate !== null && (
              <span className="ml-1.5 font-bold">₹{Number(s.finalRate).toLocaleString("en-IN")}</span>
            )}
            {typeof s.score === "number" && (
              <span className="ml-1.5 text-[var(--text-tertiary)]">{Math.round(s.score * 100)}%</span>
            )}
          </div>
          <button
            type="button"
            disabled={accepting}
            onClick={() => onAccept(Number(s.itemIndex ?? 0))}
            className="shrink-0 px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-500 text-white hover:opacity-90 disabled:opacity-50 cursor-pointer border-0"
          >
            {accepting ? "…" : s.route === "exact" ? "Quote this" : "Use as ref"}
          </button>
        </div>
      ))}
    </div>
  );
}
