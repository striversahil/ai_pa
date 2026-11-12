// Extracted verbatim from AgeingTab.tsx by scripts/refactor/split-module.mjs.
// AgeingTab.tsx re-exports everything public here, so existing imports keep working.
import { BUCKET_LABELS, CUSTOMER_SITUATIONS } from "@/debtors-tracker/types";
import type { CustomerAgeingRow } from "@/debtors-tracker/types";
import type { SortKey, SortDir } from "./types";

export const DUE_COLS = [
  { label: BUCKET_LABELS.D0, pick: (r: CustomerAgeingRow) => r.bucket0to30 },
  { label: BUCKET_LABELS.D31, pick: (r: CustomerAgeingRow) => r.bucket31to60 },
  { label: BUCKET_LABELS.D61, pick: (r: CustomerAgeingRow) => r.bucket61to90 },
  { label: BUCKET_LABELS.D91, pick: (r: CustomerAgeingRow) => r.bucket91to180 },
  { label: BUCKET_LABELS.D181, pick: (r: CustomerAgeingRow) => r.bucketAbove180 },
] as const;

/** New columns default to asc for text, desc for dates/amounts. */
export function defaultDir(key: SortKey): SortDir {
  return key === "customerName" || key === "contact" || key === "situation" ? "asc" : "desc";
}

export const SITUATION_ORDER = ["", ...CUSTOMER_SITUATIONS];

export const SITUATION_BADGE: Record<string, string> = {
  NOT_ANSWERING: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  BUSY: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  CALLBACK: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  PROMISED_TO_PAY: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  DISPUTED: "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300",
  PAID_CLOSED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-500/10 dark:text-zinc-400",
};
