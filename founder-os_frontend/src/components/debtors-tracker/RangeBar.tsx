"use client";

// RangeBar — the Debtors Tracker's "as of" control + historical banner.
//
// Split out of DebtorsTrackerDashboard so that file stays under the 400-line
// threshold (AGENTS.md). The dashboard owns the range state; this component
// only renders the picker and states, in plain words, what a historical view
// can and cannot know.

import DateRangePicker from "@/components/ui/DateRangePicker";
import { shortDate } from "@/debtors-tracker/types";
import type { AsOfCoverage } from "@/debtors-tracker/types";
import {
  activePresetKey, presetsFor, type DebtorsRange,
} from "@/debtors-tracker/range";
import { todayIST } from "@/debtors-tracker/promise";

export default function RangeBar({
  range,
  onChange,
  coverage,
  isHistorical,
  asOfIST,
  rangeFrom,
  caveats,
  disabled,
}: {
  range: DebtorsRange;
  onChange: (next: DebtorsRange) => void;
  coverage: AsOfCoverage;
  isHistorical: boolean;
  asOfIST: string;
  rangeFrom: string | null;
  caveats: string[];
  disabled?: boolean;
}) {
  const today = todayIST();
  const presets = presetsFor(today, coverage.firstInvoiceDate);
  const active = activePresetKey(range, today, coverage.firstInvoiceDate);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DateRangePicker
          value={range}
          onChange={onChange}
          min={coverage.firstInvoiceDate}
          max={today}
          presets={presets}
          activePreset={active}
          label="As of"
          disabled={disabled}
        />
        {isHistorical && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            Historical snapshot · {shortDate(asOfIST)}
            {rangeFrom ? ` vs ${shortDate(rangeFrom)}` : ""}
          </span>
        )}
      </div>

      {isHistorical && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              Read-only view of the ledger as it stood on {shortDate(asOfIST)}
              {rangeFrom ? `, compared with ${shortDate(rangeFrom)}` : ""}.
            </p>
            <button
              type="button"
              onClick={() => onChange({ from: null, to: null })}
              className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50"
            >
              Back to today
            </button>
          </div>
          <ul className="mt-1.5 space-y-0.5 opacity-90">
            {caveats.map((c) => (
              <li key={c}>· {c}</li>
            ))}
            <li>· Imports, edits, pins and reminders are disabled while viewing history.</li>
          </ul>
          {coverage.firstInvoiceDate && (
            <p className="mt-1 opacity-75">
              Ledger coverage: {shortDate(coverage.firstInvoiceDate)}
              {coverage.lastCollectionDate ? ` → receipts to ${shortDate(coverage.lastCollectionDate)}` : ""}
              {coverage.firstImportAt ? ` · first import ${shortDate(coverage.firstImportAt)}` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
