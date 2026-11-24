"use client";

// ComparisonSection — "then vs now" for the Debtors Tracker Summary tab.
//
// Rendered only when the range picker has a comparison date. Every number is
// as-of the selected dates (backend as-of.ts); this file only lays them out.
// Split out of SummaryTab to keep it under the 400-line threshold.

import { BUCKET_LABELS, formatINR, shortDate } from "@/debtors-tracker/types";
import type { DebtorsAsOfCompare, SummaryRow } from "@/debtors-tracker/types";
import { AGEING_BUCKETS } from "@/debtors-tracker/buckets";
import { Card, MiniStat } from "../../ui";

const METRICS: Array<{ key: keyof SummaryRow; label: string; good: "up" | "down" | "none" }> = [
  { key: "totalReceivable", label: "Total receivable", good: "down" },
  { key: "notDue", label: "Not due", good: "none" },
  { key: "grossDue", label: "Gross due / overdue", good: "down" },
  { key: "advanceReceived", label: "Advance received", good: "up" },
  { key: "netDue", label: "Net due", good: "down" },
];

function deltaTone(value: number, good: "up" | "down" | "none"): string {
  if (Math.abs(value) < 0.005 || good === "none") return "text-zinc-500 dark:text-zinc-400";
  const positive = value > 0;
  const isGood = good === "up" ? positive : !positive;
  return isGood ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
}

function Delta({ value, good }: { value: number; good: "up" | "down" | "none" }) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return (
    <span className={`tabular-nums ${deltaTone(value, good)}`}>
      {sign}
      {formatINR(Math.abs(value), false)}
    </span>
  );
}

function BucketBar({ thenValue, nowValue, max }: { thenValue: number; nowValue: number; max: number }) {
  const pct = (v: number) => (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);
  return (
    <div className="flex flex-col gap-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-zinc-400/70 dark:bg-zinc-500/60" style={{ width: `${pct(thenValue)}%` }} />
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct(nowValue)}%` }} />
      </div>
    </div>
  );
}

export default function ComparisonSection({ compare }: { compare: DebtorsAsOfCompare }) {
  const { then, now, movement, migration } = compare;
  const thenS = then.summary;
  const nowS = now.summary;
  const bucketMax = Math.max(
    1,
    ...AGEING_BUCKETS.flatMap((b) => [Number(thenS[b.key]) || 0, Number(nowS[b.key]) || 0]),
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800/70">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Then vs now</h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {shortDate(compare.from)} → {shortDate(compare.to)} · rebuilt from invoice and receipt dates
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-zinc-400/70" />{shortDate(compare.from)}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-indigo-500" />{shortDate(compare.to)}</span>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">
                <th className="pb-2 font-semibold">Metric</th>
                <th className="pb-2 text-right font-semibold">{shortDate(compare.from)}</th>
                <th className="pb-2 text-right font-semibold">{shortDate(compare.to)}</th>
                <th className="pb-2 text-right font-semibold">Change</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => {
                const before = Number(thenS[m.key]) || 0;
                const after = Number(nowS[m.key]) || 0;
                return (
                  <tr key={m.key} className="border-t border-zinc-100 dark:border-zinc-800/60">
                    <td className="py-2 font-medium text-zinc-700 dark:text-zinc-300">{m.label}</td>
                    <td className="py-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{formatINR(before, false)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formatINR(after, false)}</td>
                    <td className="py-2 text-right font-medium"><Delta value={after - before} good={m.good} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
            Ageing shift
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
            {AGEING_BUCKETS.map((b) => {
              const before = Number(thenS[b.key]) || 0;
              const after = Number(nowS[b.key]) || 0;
              return (
                <div key={b.key} className={`rounded-xl border p-3 ${b.tile}`}>
                  <div className="flex items-center gap-1.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                    <span className={`h-1.5 w-1.5 rounded-full ${b.dot}`} />
                    {b.label}
                  </div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className={`text-sm font-semibold tabular-nums ${b.text}`}>{formatINR(after)}</span>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500">from {formatINR(before)}</span>
                  </div>
                  <div className="mt-1.5"><BucketBar thenValue={before} nowValue={after} max={bucketMax} /></div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-zinc-100 pt-4 sm:grid-cols-3 xl:grid-cols-5 dark:border-zinc-800/60">
          <MiniStat label="Invoiced in range" value={formatINR(movement.invoicedInRange, false)} />
          <MiniStat label="Collected in range" value={formatINR(movement.collectedInRange, false)} />
          <MiniStat label="Advances in range" value={formatINR(movement.advanceInRange, false)} />
          <MiniStat label="Sheet adjustments" value={formatINR(movement.sheetAdjustments, false)} />
          <MiniStat label="Net due change" value={formatINR(movement.netDueChange, false)} />
        </div>

        <div className="grid gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-2 dark:border-zinc-800/60">
          <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-600 dark:text-zinc-300">
            <span>Bills booked <b className="tabular-nums">{movement.invoicesBooked}</b></span>
            <span>Bills settled <b className="tabular-nums">{movement.invoicesSettled}</b></span>
            <span>Customers added <b className="tabular-nums">{movement.customersAdded}</b></span>
            <span>Customers settled <b className="tabular-nums">{movement.customersSettled}</b></span>
            <span>Aged deeper <b className="tabular-nums text-rose-600 dark:text-rose-400">{movement.agedDeeper}</b></span>
            <span>Aged back <b className="tabular-nums text-emerald-600 dark:text-emerald-400">{movement.agedShallower}</b></span>
            <span>Paid in full <b className="tabular-nums text-emerald-600 dark:text-emerald-400">{movement.paidInRange}</b></span>
          </div>
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
              Biggest bucket moves
            </div>
            {migration.length === 0 ? (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">No bill changed ageing bucket in this range.</p>
            ) : (
              <ul className="space-y-1 text-[11px] text-zinc-600 dark:text-zinc-300">
                {migration.slice(0, 5).map((m) => (
                  <li key={`${m.fromBucket}-${m.toBucket}`} className="flex items-center justify-between gap-2">
                    <span>
                      {BUCKET_LABELS[m.fromBucket as keyof typeof BUCKET_LABELS] ?? m.fromBucket}
                      {" → "}
                      {BUCKET_LABELS[m.toBucket as keyof typeof BUCKET_LABELS] ?? m.toBucket}
                    </span>
                    <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
                      {m.count} bill{m.count === 1 ? "" : "s"} · {formatINR(m.amount, false)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
