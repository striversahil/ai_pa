/**
 * Shared ageing-bucket presentation (label + Tailwind tones).
 *
 * One source of truth so the receivables ageing chart, the promised-to-pay
 * chart and any future bucket view stay visually identical. The bucket keys
 * match `SummaryRow` / `CustomerAgeingRow` — the maths lives on the backend.
 */

export type AgeingBucketKey =
  | "bucket0to30"
  | "bucket31to60"
  | "bucket61to90"
  | "bucket91to180"
  | "bucketAbove180";

export interface AgeingBucketTone {
  key: AgeingBucketKey;
  label: string;
  /** Solid bar / stacked-slice colour. */
  bar: string;
  dot: string;
  text: string;
  tile: string;
}

export const AGEING_BUCKETS: readonly AgeingBucketTone[] = [
  { key: "bucket0to30", label: "0–30 Days", bar: "bg-emerald-500", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", tile: "border-emerald-100 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/15" },
  { key: "bucket31to60", label: "31–60 Days", bar: "bg-lime-500", dot: "bg-lime-500", text: "text-lime-700 dark:text-lime-400", tile: "border-lime-100 bg-lime-50/40 dark:border-lime-900/40 dark:bg-lime-950/15" },
  { key: "bucket61to90", label: "61–90 Days", bar: "bg-amber-500", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", tile: "border-amber-100 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/15" },
  { key: "bucket91to180", label: "91–180 Days", bar: "bg-orange-500", dot: "bg-orange-500", text: "text-orange-700 dark:text-orange-400", tile: "border-orange-100 bg-orange-50/40 dark:border-orange-900/40 dark:bg-orange-950/15" },
  { key: "bucketAbove180", label: "Above 180 Days", bar: "bg-rose-500", dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400", tile: "border-rose-100 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/15" },
];
