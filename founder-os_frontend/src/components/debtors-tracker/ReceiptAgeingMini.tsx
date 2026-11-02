"use client";

import type {
  LiveCollection, ReceiptAgeingSplit, ReceiptBucketKey, ReceiptBucketWindow,
} from "@/debtors-tracker/types";
import { formatCompactINR, formatINR, shortDate } from "@/debtors-tracker/types";

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

/** Receipts whose collection date falls inside a window's inclusive range. */
function receiptsInWindow(collections: LiveCollection[], w: ReceiptBucketWindow): LiveCollection[] {
  if (!w.from || !w.to) return [];
  return collections.filter((c) => {
    const day = c.collectionDate || "";
    return !!c.receiptBucket && day >= w.from && day <= w.to;
  });
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-3 w-3 shrink-0 text-zinc-400 transition-transform group-open:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 8 5 5 5-5" />
    </svg>
  );
}

/** Who paid, grouped by the bucket their receipt cleared. */
function WindowReceipts({ receipts }: { receipts: LiveCollection[] }) {
  if (!receipts.length) {
    return <p className="px-1 py-1 text-[10px] text-zinc-400 dark:text-zinc-500">No receipt detail for this window.</p>;
  }
  return (
    <div className="space-y-2">
      {SEGMENTS.map((segment) => {
        const rows = receipts
          .filter((r) => r.receiptBucket === segment.key)
          .sort((a, b) => b.amount - a.amount || a.customerName.localeCompare(b.customerName));
        if (!rows.length) return null;
        const subtotal = rows.reduce((sum, r) => sum + r.amount, 0);
        return (
          <div key={segment.key}>
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${segment.dot}`} />
                {segment.label}
              </span>
              <span className="whitespace-nowrap text-[9px] tabular-nums text-zinc-400 dark:text-zinc-500">
                {formatINR(subtotal, false)} · {rows.length} receipt{rows.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="mt-0.5">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-baseline justify-between gap-2 rounded px-1.5 py-1 hover:bg-white/80 dark:hover:bg-zinc-900/60"
                  title={[r.remarks, r.receiptNo].filter(Boolean).join(" · ")}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-medium text-zinc-800 dark:text-zinc-100">
                      {r.customerName}
                    </span>
                    <span className="block truncate text-[9px] text-zinc-400 dark:text-zinc-500">
                      {shortDate(r.collectionDate)}
                      {[r.mode, r.invoiceNo].filter(Boolean).map((v) => ` · ${v}`).join("")}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">
                    {formatINR(r.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function rangeLabel(w: ReceiptBucketWindow): string {
  if (!w.from && !w.to) return "";
  if (w.from === w.to) return shortDate(w.from);
  return `${shortDate(w.from)} – ${shortDate(w.to)}`;
}

function BucketRow({
  label, bucketWindow, receipts,
}: {
  label: string;
  bucketWindow: ReceiptBucketWindow;
  receipts: LiveCollection[];
}) {
  const active = SEGMENTS
    .map((segment) => ({ ...segment, ...bucketWindow.buckets[segment.key] }))
    .filter((segment) => segment.amount > 0);
  const total = bucketWindow.total;

  return (
    /* Collapsed by default: open a window to see who paid and which bucket it cleared. */
    <details className="group rounded-lg -mx-1 px-1 hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="whitespace-nowrap text-[10px] font-semibold text-zinc-600 dark:text-zinc-300">{label}</span>
            <span className="truncate text-[9px] tabular-nums text-zinc-400 dark:text-zinc-500" title={rangeLabel(bucketWindow)}>
              {rangeLabel(bucketWindow)}
            </span>
            <Chevron />
          </span>
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
      </summary>

      <div className="mt-1 mb-0.5 max-h-52 overflow-y-auto rounded-lg border border-zinc-200/70 bg-white/60 px-1.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-900/40">
        <WindowReceipts receipts={receipts} />
      </div>
    </details>
  );
}

export default function ReceiptAgeingMini({
  split, collections = [],
}: {
  split?: ReceiptAgeingSplit | null;
  collections?: LiveCollection[];
}) {
  if (!split) return null;
  return (
    <div className="flex flex-1 flex-col border-t border-zinc-200/80 px-4 py-4 dark:border-zinc-800">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
        Received by ageing bucket
      </div>
      <p className="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
        Invoice bucket on receipt date, before that receipt · open a window for who paid
      </p>
      {/* Grows into any height the card gets from its neighbour, so the chart
          below the daily bars fills the space instead of leaving a blank band. */}
      <div className="mt-3 flex flex-1 flex-col justify-between gap-3">
        <BucketRow label="This week" bucketWindow={split.week} receipts={receiptsInWindow(collections, split.week)} />
        {/* Absent while an older cached payload is still in flight. */}
        {split.lastWeek && (
          <BucketRow label="Last week" bucketWindow={split.lastWeek} receipts={receiptsInWindow(collections, split.lastWeek)} />
        )}
        <BucketRow label="This month" bucketWindow={split.month} receipts={receiptsInWindow(collections, split.month)} />
      </div>
    </div>
  );
}
