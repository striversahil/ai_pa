"use client";

import { useMemo } from "react";
import type { CustomerAgeingRow } from "@/debtors-tracker/types";
import { formatINR } from "@/debtors-tracker/types";
import { formatPromiseDate, promiseStatusLabel } from "@/debtors-tracker/promise";
import { AGEING_BUCKETS } from "@/debtors-tracker/buckets";
import {
  buildPromiseSummary,
  promiseClientsInBucket,
  promiseClientsInDue,
  type PromiseClientEntry,
  type PromiseDueKey,
} from "@/debtors-tracker/promise-summary";
import { Card, EmptyState, MiniStat } from "./ui";

/**
 * Promised-to-pay money, broken down by ageing bucket, promise date and
 * current client situation.
 *
 * Every category is a default-collapsed dropdown: open one to see exactly
 * which clients promised, when, and how much of their net due sits in that
 * category. A promise survives a situation change; a newer promise replaces
 * it and Paid / Closed clears it.
 */

const DUE_TONES: Record<PromiseDueKey, { bar: string; text: string; chip: string }> = {
  overdue: {
    bar: "bg-rose-500",
    text: "text-rose-600 dark:text-rose-400",
    chip: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  },
  today: {
    bar: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-400",
    chip: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  },
  next7: {
    bar: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  },
  later: {
    bar: "bg-sky-500",
    text: "text-sky-600 dark:text-sky-400",
    chip: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  },
};

const DUE_EMPTY: Record<PromiseDueKey, string> = {
  overdue: "No promise is overdue.",
  today: "Nothing promised for today.",
  next7: "Nothing promised in the next 7 days.",
  later: "No promises beyond 7 days.",
};

function pct(part: number, whole: number): number {
  if (!(whole > 0) || !isFinite(part)) return 0;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}

function clientLabel(n: number): string {
  return `${n} client${n === 1 ? "" : "s"}`;
}

function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform group-open:rotate-180 ${className}`}
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

/** One category's client list: who promised, when, and their money in it. */
function PromiseClientList({
  entries, asOfIST, emptyLabel,
}: {
  entries: PromiseClientEntry[];
  asOfIST: string;
  emptyLabel: string;
}) {
  if (entries.length === 0) {
    return <p className="px-2 py-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-0.5">
      {entries.map(({ client, amount }) => {
        const tone = DUE_TONES[client.dueKey];
        return (
          <li
            key={client.customerKey || client.customerName}
            className="rounded-lg px-2 py-1.5 hover:bg-white/80 dark:hover:bg-zinc-900/50"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[11px] font-medium text-zinc-800 dark:text-zinc-100">
                {client.customerName}
              </span>
              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">
                {formatINR(amount)}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-zinc-500 dark:text-zinc-400">
              <span className="tabular-nums">{formatPromiseDate(client.promisedDate)}</span>
              <span className={`rounded-full px-1.5 py-0.5 font-medium ${tone.chip}`}>
                {promiseStatusLabel(client.promisedDate, asOfIST)}
              </span>
              <span className="truncate opacity-80">{client.situationLabel}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function PromiseOverview({
  customers, asOfIST,
}: {
  customers: CustomerAgeingRow[];
  asOfIST: string;
}) {
  const stats = useMemo(() => buildPromiseSummary(customers, asOfIST), [customers, asOfIST]);
  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800/70">
      <div>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Promised to pay</h3>
        <p className="mt-0.5 max-w-xl text-xs text-zinc-500 dark:text-zinc-400">
          Money clients have committed to pay, split by how overdue the bills are. Open any category to
          see which clients promised and when. A promise survives a situation change; a newer promise
          replaces it and Paid / Closed clears it.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {stats.overdueClients > 0 && (
          <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
            {formatINR(stats.overdueAmount, false)} overdue
          </span>
        )}
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">Promised</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatINR(stats.total, false)}
          </div>
          <div className="mt-0.5 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
            {clientLabel(stats.clients)} · {stats.promisedShare.toFixed(0)}% of collectible
          </div>
        </div>
      </div>
    </div>
  );

  if (stats.clients === 0) {
    return (
      <Card className="overflow-hidden">
        {header}
        <EmptyState
          title="No promised-to-pay dates yet"
          hint="Open a client from Customer Ageing, choose Promised to pay and pick the day count — the promised money, its ageing category and the promise date appear here."
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      {header}

      <div className="space-y-5 p-5">
        {/* Promised money by ageing category */}
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-zinc-100 ring-1 ring-inset ring-zinc-200/60 dark:bg-zinc-800 dark:ring-zinc-700/40">
          {AGEING_BUCKETS.map((b) => {
            const slice = stats.buckets.find((s) => s.key === b.key);
            const value = Math.max(0, slice?.amount || 0);
            if (value <= 0) return null;
            return (
              <div
                key={b.key}
                className={`${b.bar} h-full first:rounded-l-full last:rounded-r-full`}
                style={{ width: `${pct(value, stats.total)}%` }}
                title={`${b.label}: ${formatINR(value, false)} promised`}
              />
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
          {AGEING_BUCKETS.map((b) => {
            const slice = stats.buckets.find((s) => s.key === b.key);
            const value = Math.max(0, slice?.amount || 0);
            const entries = promiseClientsInBucket(stats, b.key);
            return (
              <details key={b.key} className={`group rounded-xl border ${b.tile}`}>
                <summary
                  className="cursor-pointer list-none p-3 [&::-webkit-details-marker]:hidden"
                  title={`${formatINR(value, false)} promised across ${clientLabel(entries.length)} with money in this bucket`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="flex items-center gap-1.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                      <span className={`h-1.5 w-1.5 rounded-full ${b.dot}`} />
                      {b.label}
                    </span>
                    <Chevron className="h-3 w-3" />
                  </div>
                  <div className={`mt-1.5 text-sm font-semibold tabular-nums ${b.text}`}>{formatINR(value)}</div>
                  <div className="mt-0.5 flex items-center justify-between gap-1 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
                    <span>{pct(value, stats.total).toFixed(1)}% of promised</span>
                    <span>{entries.length > 0 ? clientLabel(entries.length) : "—"}</span>
                  </div>
                </summary>
                <div className="max-h-56 overflow-y-auto border-t border-zinc-900/5 px-1.5 py-1.5 dark:border-white/10">
                  <PromiseClientList
                    entries={entries}
                    asOfIST={asOfIST}
                    emptyLabel="No promised money in this bucket."
                  />
                </div>
              </details>
            );
          })}
        </div>

        <div className="grid gap-5 border-t border-zinc-100 pt-4 lg:grid-cols-2 dark:border-zinc-800/60">
          {/* When the money is promised — one dropdown per timing category */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                When it is promised
              </h4>
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">open a category for clients</span>
            </div>
            <div className="space-y-1">
              {stats.due.map((row) => {
                const tone = DUE_TONES[row.key];
                const entries = promiseClientsInDue(stats, row.key);
                return (
                  <details key={row.key} className="group">
                    <summary
                      className="flex cursor-pointer list-none items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 [&::-webkit-details-marker]:hidden"
                      title={`${row.label}: ${formatINR(row.amount, false)} · ${clientLabel(row.clients)}`}
                    >
                      <span className="w-[104px] shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">{row.label}</span>
                      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${pct(row.amount, stats.total)}%` }} />
                      </div>
                      <span className={`w-[74px] shrink-0 text-right text-[11px] font-semibold tabular-nums ${row.amount > 0 ? tone.text : "text-zinc-300 dark:text-zinc-700"}`}>
                        {formatINR(row.amount)}
                      </span>
                      <span className={`w-[52px] shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-center text-[10px] font-medium tabular-nums ${row.clients > 0 ? tone.chip : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"}`}>
                        {row.clients}
                      </span>
                      <Chevron className="h-3 w-3" />
                    </summary>
                    <div className="max-h-56 overflow-y-auto py-1 pl-1 pr-1">
                      <PromiseClientList
                        entries={entries}
                        asOfIST={asOfIST}
                        emptyLabel={DUE_EMPTY[row.key]}
                      />
                    </div>
                  </details>
                );
              })}
            </div>
          </section>

          {/* By current client situation */}
          <section className="space-y-2 lg:border-l lg:border-zinc-100 lg:pl-5 dark:lg:border-zinc-800/60">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                By client situation
              </h4>
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">promise kept across situations</span>
            </div>
            <div className="space-y-1.5">
              {stats.situations.map((row) => (
                <div
                  key={row.situation || "unset"}
                  className="flex items-center gap-2.5"
                  title={`${row.label}: ${formatINR(row.amount, false)} · ${clientLabel(row.clients)}`}
                >
                  <span className="w-[104px] shrink-0 truncate text-[11px] text-zinc-500 dark:text-zinc-400">{row.label}</span>
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct(row.amount, stats.total)}%` }} />
                  </div>
                  <span className="w-[74px] shrink-0 text-right text-[11px] font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">
                    {formatINR(row.amount)}
                  </span>
                  <span className="w-[52px] shrink-0 whitespace-nowrap rounded-full bg-indigo-50 px-1.5 py-0.5 text-center text-[10px] font-medium tabular-nums text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                    {row.clients}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-4 dark:border-zinc-800/60">
          <MiniStat label="Promised" value={formatINR(stats.total, false)} />
          <MiniStat label="Promise overdue" value={`${formatINR(stats.overdueAmount, false)} · ${stats.overdueClients}`} />
          <MiniStat label="No promise yet" value={`${formatINR(stats.unpromisedDue, false)} · ${stats.unpromisedClients}`} />
          <MiniStat label="Promised share" value={`${stats.promisedShare.toFixed(0)}% of collectible`} />
        </div>
      </div>
    </Card>
  );
}
