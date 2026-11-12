"use client";

// Extracted verbatim from PaymentDues.tsx by scripts/refactor/split-module.mjs.
// PaymentDues.tsx re-exports everything public here, so existing imports keep working.
import { inr } from "../payment-calendar";

/** Amount cell. A null amount is normal for credit cards (the statement sets
 *  it) and for variable bills, so it must read as "not known yet" instead of
 *  the bare em-dash that looks like a rendering bug. `compact` is for the
 *  group header, where the cycle rows below already spell it out. */
export function Amount({ value, compact }: { value: number | null | undefined; compact?: boolean }) {
  if (value === null || value === undefined) {
    return (
      <span
        className="text-[11px] font-bold uppercase tracking-wide text-zinc-400 dark:text-zinc-500"
        title="Amount not known yet — a credit card's figure arrives with its statement"
      >
        {compact ? "TBD" : "Amount TBD"}
      </span>
    );
  }
  return <>{inr(value)}</>;
}
