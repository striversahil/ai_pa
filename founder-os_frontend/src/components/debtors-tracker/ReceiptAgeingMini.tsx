"use client";

import type {
  ReceiptAgeingSplit, ReceiptBucketKey, ReceiptBucketWindow,
} from "@/debtors-tracker/types";
import { formatCompactINR, formatINR } from "@/debtors-tracker/types";

type Segment = {
  key: ReceiptBucketKey;
  label: string;
  short: string;
  bar: string;
  dot: string;
};

const SEGMENTS: Segment[] = [
  { key: "NOT_DUE", label: "Not due", short: "Not due", bar: "bg-sky-500", dot: "bg-sky-500" },
  { key: "D0", label: "0–30 days", short: "0–30", bar: "bg-emerald-500", dot: "bg-emerald-500" },
  { key: "D31", label: "31–60 days", short: "31–60", bar: "bg-lime-500", dot: "bg-lime-500" },
  { key: "D61", label: "61–90 days", short: "61–90", bar: "bg-amber-500", dot: "bg-amber-500" },
  { key: "D91", label: "91–180 days", short: "91–180", bar: "bg-orange-500", dot: "bg-orange-500" },
  { key: "D181", label: "Above 180 days", short: "180+", bar: "bg-rose-500", dot: "bg-rose-500" },
  { key: "ADVANCE", label: "Advance / unapplied", short: "Advance", bar: "bg-violet-500", dot: "bg-violet-500" },
];

function BucketRow({ label, bucketWindow }: { label: string; bucketWindow: ReceiptBucketWindow }) {
  const active = SEGMENTS
    .map((segment) => ({ ...segment, ...bucketWindow.buckets[segment.key] }))
    .filter((segment) => segment.amount > 0);
  const total = bucketWindow.total;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold text-zinc-600 dark:text-zinc-300">{label}</span>
        <span className="whitespace-nowrap text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
          {formatINR(total, false)}
          <span className="text-zinc-400 dark:text-zinc-500"> · {bucketWindow.count} receipt{bucketWindow.count === 1 ? "" : "s"}</span>
        </span>
      </div>

      <div className="mt-1.5 flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 ring-1 ring-inset ring-zinc-200/60 dark:bg-zinc-800 dark:ring-zinc-700/40">
        {total > 0 ? active.map((segment) => (
          <div
            key={segment.key}
            className={`${segment.bar} h-full first:rounded-l-full last:rounded-r-full`}
            style={{ width: `${(segment.amount / total) * 100}%` }}
            title={`${segment.label}: ${formatINR(segment.amount, false)} · ${segment.count} receipt${segment.count === 1 ? "" : "s"}`}
          />
        )) : <div className="h-full w-full bg-zinc-200/60 dark:bg-zinc-700/40" />}
      </div>

      {total > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-1">
          {active.map((segment) => (
            <span
              key={segment.key}
              className="inline-flex items-center gap-1 text-[9px] tabular-nums text-zinc-500 dark:text-zinc-400"
              title={`${segment.label}: ${formatINR(segment.amount, false)} · ${segment.count} receipt${segment.count === 1 ? "" : "s"}`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${segment.dot}`} />
              {segment.short}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{formatCompactINR(segment.amount)}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">No receipts in this window</div>
      )}
    </div>
  );
}

export default function ReceiptAgeingMini({ split }: { split?: ReceiptAgeingSplit | null }) {
  if (!split) return null;
  return (
    <div className="border-t border-zinc-200/80 px-4 py-4 dark:border-zinc-800">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
        Received by ageing bucket
      </div>
      <p className="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
        Invoice bucket on receipt date, before that receipt
      </p>
      <div className="mt-3 space-y-3.5">
        <BucketRow label="This week" bucketWindow={split.week} />
        <BucketRow label="This month" bucketWindow={split.month} />
      </div>
    </div>
  );
}
