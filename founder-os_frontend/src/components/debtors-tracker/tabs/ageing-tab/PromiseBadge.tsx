"use client";

// Extracted verbatim from AgeingTab.tsx by scripts/refactor/split-module.mjs.
// AgeingTab.tsx re-exports everything public here, so existing imports keep working.
import { shortDate } from "@/debtors-tracker/types";
import type { CustomerAgeingRow } from "@/debtors-tracker/types";
import { promiseStatus, formatPromiseDate, promiseStatusLabel } from "@/debtors-tracker/promise";

/**
 * Promise is deliberately independent of the situation: after "Promised to pay"
 * a later "Not answering" call keeps the date as "Last promise" until a newer
 * promise replaces it (or Paid / Closed clears it).
 */
export function PromiseBadge({ row, today }: { row: CustomerAgeingRow; today: string }) {
  const settled = row.netDue <= 0 || row.situation === "PAID_CLOSED";
  if (settled) return null;
  if (!row.promisedDate) {
    if (row.situation !== "PROMISED_TO_PAY") return null;
    return (
      <span className="inline-block rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
        No promise date
      </span>
    );
  }
  const state = promiseStatus(row.promisedDate, today);
  const cls = state === "overdue"
    ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
    : state === "today"
      ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
      : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300";
  const isCurrent = row.situation === "PROMISED_TO_PAY";
  return (
    <span
      className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
      title={`${isCurrent ? "Promised" : "Last promised"} ${formatPromiseDate(row.promisedDate)}${row.promisedBy ? ` · set by ${row.promisedBy}` : ""}`}
    >
      {isCurrent ? "Promise" : "Last promise"} {shortDate(row.promisedDate)} · {promiseStatusLabel(row.promisedDate, today)}
    </span>
  );
}
