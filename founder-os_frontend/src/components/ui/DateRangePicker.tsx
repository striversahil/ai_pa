"use client";

// DateRangePicker — shared two-date "as of / compared with" control.
//
// One home for the pattern used by the Debtors Tracker Summary range (and any
// other dashboard that needs point-in-time comparison — e.g. the Sales
// leaderboard date filter; do NOT fork a second copy).
//
// Contract: `from` is the comparison date, `to` the snapshot date. Both null =
// live. Callers own the meaning; this component only edits the pair and keeps
// it valid (a comparison must be strictly before the snapshot).

import { useMemo } from "react";

export interface DateRangeValue {
  from: string | null;
  to: string | null;
}

export interface DateRangePreset {
  key: string;
  label: string;
  from: string | null;
  to: string | null;
}

export interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  /** Today (IST) — the latest selectable snapshot. */
  max?: string | null;
  /** Earliest date the data can speak about. */
  min?: string | null;
  presets?: DateRangePreset[];
  activePreset?: string | null;
  /** Snapshot-date label shown before the inputs. */
  label?: string;
  disabled?: boolean;
  className?: string;
}

export default function DateRangePicker({
  value,
  onChange,
  max,
  min,
  presets,
  activePreset,
  label = "As of",
  disabled,
  className,
}: DateRangePickerProps) {
  const ceiling = max ?? undefined;
  const floor = min && (!max || min < max) ? min : undefined;

  const inputClass = useMemo(
    () =>
      "rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-800 shadow-sm outline-none transition focus:border-indigo-400 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200",
    [],
  );

  const setFrom = (raw: string) => {
    const from = raw || null;
    // A comparison must be strictly before the snapshot; otherwise drop it
    // (the snapshot stays, so the view never silently becomes live by accident).
    const to = value.to ?? max ?? null;
    onChange({ ...value, from: from && (!to || from < to) ? from : null });
  };

  const setTo = (raw: string) => {
    const to = raw || null;
    const from = value.from && (!to || value.from < to) ? value.from : null;
    onChange({ from, to });
  };

  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-[11px] ${className ?? ""}`}>
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {presets.map((p) => {
            const active = activePreset === p.key;
            return (
              <button
                key={p.key}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ from: p.from, to: p.to })}
                className={`rounded-full border px-2.5 py-1 font-medium transition disabled:opacity-60 ${
                  active
                    ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-300"
                    : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}

      <label className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        <span className="font-medium">{label}</span>
        <input
          type="date"
          aria-label="Snapshot date"
          value={value.to ?? max ?? ""}
          max={ceiling}
          min={floor}
          disabled={disabled}
          onChange={(e) => setTo(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        <span className="font-medium">vs</span>
        <input
          type="date"
          aria-label="Comparison date"
          value={value.from ?? ""}
          max={value.to ?? ceiling}
          min={floor}
          disabled={disabled}
          onChange={(e) => setFrom(e.target.value)}
          className={inputClass}
        />
      </label>

      {(value.from || value.to) && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ from: null, to: null })}
          className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 font-medium text-zinc-500 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
          title="Back to the live view"
        >
          Live
        </button>
      )}
    </div>
  );
}
