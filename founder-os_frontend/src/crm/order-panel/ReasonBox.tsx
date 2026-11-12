"use client";

// Extracted verbatim from OrderPanel.tsx by scripts/refactor/split-module.mjs.
// OrderPanel.tsx re-exports everything public here, so existing imports keep working.
import { REASON_MIN } from "../lifecycle";

export function ReasonBox({
  label,
  value,
  onChange,
  optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}) {
  const short = value.trim().length > 0 && value.trim().length < REASON_MIN;
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-500">
        {label} {optional ? <em className="font-normal normal-case text-zinc-400">— if needed</em> : null}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder={optional ? "" : `At least ${REASON_MIN} characters…`}
        className={`w-full resize-y rounded-lg border bg-white px-3 py-2 text-xs outline-none focus:border-indigo-500 dark:bg-zinc-900 ${
          short ? "border-amber-400" : "border-zinc-300 dark:border-zinc-700"
        }`}
      />
      {short && <span className="mt-0.5 block text-[10px] text-amber-600 dark:text-amber-400">Keep going — {REASON_MIN - value.trim().length} more characters.</span>}
    </label>
  );
}
