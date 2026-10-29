"use client";

import type { ReactNode } from "react";
import type { CustomerAgeingRow, LiveCollection, ReceiptAgeingSplit, SummaryRow } from "@/debtors-tracker/types";
import { formatCompactINR, formatINR, isAdvanceReceipt, shortDate } from "@/debtors-tracker/types";
import { AGEING_BUCKETS as BUCKETS } from "@/debtors-tracker/buckets";
import ReceiptAgeingMini from "../ReceiptAgeingMini";
import PromiseOverview from "../PromiseOverview";
import { Card, EmptyState, MiniStat } from "../ui";

const ACCENTS = {
  zinc: { bar: "bg-zinc-700 dark:bg-zinc-300", dot: "bg-zinc-300 dark:bg-zinc-600", icon: "text-zinc-500 dark:text-zinc-400" },
  sky: { bar: "bg-sky-500", dot: "bg-sky-400", icon: "text-sky-600 dark:text-sky-400" },
  rose: { bar: "bg-rose-500", dot: "bg-rose-400", icon: "text-rose-600 dark:text-rose-400" },
  emerald: { bar: "bg-emerald-500", dot: "bg-emerald-400", icon: "text-emerald-600 dark:text-emerald-400" },
  amber: { bar: "bg-amber-500", dot: "bg-amber-400", icon: "text-amber-600 dark:text-amber-400" },
} as const;

type Accent = keyof typeof ACCENTS;

function dayOffset(asOf: string, daysAgo: number): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function dayLabel(day: string): string {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

/** Monday of the week containing an ISO date (IST date-only). */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

function sumAmounts(rows: LiveCollection[]): number {
  return rows.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
}

function SectionHeading({
  eyebrow, title, description, accent, icon, right,
}: {
  eyebrow: string;
  title: string;
  description: string;
  accent: Accent;
  icon: "receivables" | "collections";
  right?: ReactNode;
}) {
  const a = ACCENTS[accent];
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-10 w-10 place-items-center rounded-xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 ${a.icon}`}>
          {icon === "receivables" ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M7 3.75h7l3.5 3.5V20a.25.25 0 0 1-.25.25H7.25A.25.25 0 0 1 7 20V4a.25.25 0 0 1 .25-.25Z" strokeLinejoin="round" />
              <path d="M14 3.75V7.5h3.75M9.5 11.5h5M9.5 15h5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3.75 7.5h16.5v9H3.75z" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="2.25" />
              <path d="M6.5 7.5v9M17.5 7.5v9" strokeLinecap="round" opacity=".45" />
            </svg>
          )}
        </span>
        <div>
          <div className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${a.icon}`}>{eyebrow}</div>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

function MetricCard({
  label, value, hint, accent = "zinc", emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: Accent;
  emphasis?: boolean;
}) {
  const a = ACCENTS[accent];
  return (
    <div className={`group relative overflow-hidden rounded-2xl border p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${
      emphasis
        ? "border-zinc-200/80 bg-gradient-to-br from-white to-zinc-50/80 dark:border-zinc-800 dark:from-zinc-900/70 dark:to-zinc-950/40"
        : "border-zinc-200/70 bg-white dark:border-zinc-800/80 dark:bg-zinc-900/40"
    }`}>
      <div className={`absolute inset-x-0 top-0 h-[2px] ${a.bar}`} />
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">{label}</div>
        <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${a.dot}`} />
      </div>
      <div className={`mt-2 text-[22px] font-semibold leading-none tabular-nums tracking-tight ${accent === "zinc" ? "text-zinc-900 dark:text-zinc-100" : a.icon}`}>
        {value}
      </div>
      {hint && <div className="mt-2 text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">{hint}</div>}
    </div>
  );
}

type AdvanceBucketKey = "previousWeek" | "previousMonth" | "advanceWeek" | "advanceMonth";

const ADVANCE_TONES: Record<AdvanceBucketKey, { surface: string; label: string; dot: string; chip: string }> = {
  previousWeek: {
    surface: "bg-gradient-to-br from-sky-50/90 via-white to-white dark:from-sky-950/30 dark:via-zinc-900/30 dark:to-zinc-900/10",
    label: "text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500",
    chip: "bg-sky-500/10 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300",
  },
  previousMonth: {
    surface: "bg-gradient-to-br from-emerald-50/90 via-white to-white dark:from-emerald-950/30 dark:via-zinc-900/30 dark:to-zinc-900/10",
    label: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
  },
  advanceWeek: {
    surface: "bg-gradient-to-br from-amber-50/90 via-white to-white dark:from-amber-950/25 dark:via-zinc-900/30 dark:to-zinc-900/10",
    label: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
    chip: "bg-amber-500/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
  },
  advanceMonth: {
    surface: "bg-gradient-to-br from-violet-50/90 via-white to-white dark:from-violet-950/30 dark:via-zinc-900/30 dark:to-zinc-900/10",
    label: "text-violet-700 dark:text-violet-300",
    dot: "bg-violet-500",
    chip: "bg-violet-500/10 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300",
  },
};

function AdvanceQuadrant({
  bucket, category, period, value, count, className = "",
}: {
  bucket: AdvanceBucketKey;
  category: string;
  period: string;
  value: number;
  count: number;
  className?: string;
}) {
  const tone = ADVANCE_TONES[bucket];
  return (
    <div className={`flex min-h-[118px] flex-col p-3.5 ${tone.surface} ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div className={`text-[9px] font-semibold uppercase leading-tight tracking-[0.13em] ${tone.label}`}>{category}</div>
        <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
      </div>
      <div className="mt-auto pt-4 text-[20px] font-semibold leading-none tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
        {formatINR(value)}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
        <span className="text-zinc-500 dark:text-zinc-400">{period}</span>
        <span className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 font-medium ${tone.chip}`}>
          {count} receipt{count === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

export default function SummaryTab({
  summary, collections, customers, asOfIST, receiptAgeing,
}: {
  summary: SummaryRow;
  collections: LiveCollection[];
  customers: CustomerAgeingRow[];
  asOfIST: string;
  receiptAgeing?: ReceiptAgeingSplit | null;
}) {
  const s = summary;
  const bucketTotal = BUCKETS.reduce((sum, b) => sum + Math.max(0, s[b.key]), 0);
  const avgReceivable = s.customerCount > 0 ? s.totalReceivable / s.customerCount : 0;

  const monthPrefix = asOfIST.slice(0, 7);
  const sevenDayStart = dayOffset(asOfIST, 6);
  const weekStart = mondayOf(asOfIST);
  const thisMonth = sumAmounts(collections.filter((c) => (c.collectionDate || "").startsWith(monthPrefix)));
  const last7 = sumAmounts(collections.filter((c) => {
    const d = c.collectionDate || "";
    return d >= sevenDayStart && d <= asOfIST;
  }));
  const advanceSplit = {
    previousWeek: { amount: 0, count: 0 },
    previousMonth: { amount: 0, count: 0 },
    advanceWeek: { amount: 0, count: 0 },
    advanceMonth: { amount: 0, count: 0 },
  };
  for (const c of collections) {
    const day = c.collectionDate || "";
    const amount = Number(c.amount) || 0;
    const inWeek = day >= weekStart && day <= asOfIST;
    const inMonth = day.startsWith(monthPrefix);
    if (isAdvanceReceipt(c)) {
      if (inWeek) { advanceSplit.advanceWeek.amount += amount; advanceSplit.advanceWeek.count++; }
      if (inMonth) { advanceSplit.advanceMonth.amount += amount; advanceSplit.advanceMonth.count++; }
    } else {
      if (inWeek) { advanceSplit.previousWeek.amount += amount; advanceSplit.previousWeek.count++; }
      if (inMonth) { advanceSplit.previousMonth.amount += amount; advanceSplit.previousMonth.count++; }
    }
  }
  const today = sumAmounts(collections.filter((c) => c.collectionDate === asOfIST));
  const unmatched = collections.filter((c) => c.matchStatus === "none").length;
  const advanceCount = collections.filter(isAdvanceReceipt).length;
  const previousCount = collections.length - advanceCount;
  const latestCollectionDate = collections.reduce((latest, c) => {
    const d = c.collectionDate || "";
    return d > latest ? d : latest;
  }, "");

  const days = Array.from({ length: 14 }, (_, i) => dayOffset(asOfIST, 13 - i));
  const daily = new Map<string, { regular: number; advance: number; total: number; count: number }>();
  for (const c of collections) {
    const day = c.collectionDate || "";
    if (!daily.has(day)) daily.set(day, { regular: 0, advance: 0, total: 0, count: 0 });
    const cur = daily.get(day)!;
    const amount = Number(c.amount) || 0;
    cur.total += amount;
    cur.count += 1;
    if (isAdvanceReceipt(c)) {
      cur.advance += amount;
    } else {
      cur.regular += amount;
    }
  }
  const maxDaily = Math.max(1, ...days.map((d) => daily.get(d)?.total || 0));

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <SectionHeading
          eyebrow="Receivables"
          title="Outstanding & ageing"
          description="Customer balances, overdue exposure and ageing buckets derived from the imported debtor ledger."
          accent="zinc"
          icon="receivables"
          right={
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
                {s.customerCount} customers
              </span>
              <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
                {s.invoiceCount} invoices
              </span>
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Total debtors receivable" value={formatINR(s.totalReceivable, false)} hint="Open invoice value across all customers" emphasis />
          <MetricCard label="Not due" value={formatINR(s.notDue)} hint="Not crossed the due date" accent="sky" />
          <MetricCard label="Gross due / overdue" value={formatINR(s.grossDue, false)} hint="Past due, before customer advances" accent="rose" />
          <MetricCard label="Advance received" value={formatINR(s.advanceReceived)} hint="Received beyond invoice value" accent="emerald" />
          <MetricCard label="Net due" value={formatINR(s.netDue, false)} hint="Gross due − advances" accent="amber" emphasis />
        </div>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800/70">
            <div>
              <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Ageing distribution</h3>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Past-due exposure across {s.customerCount} customer{s.customerCount === 1 ? "" : "s"}</p>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">Past due</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formatINR(bucketTotal, false)}</div>
            </div>
          </div>

          <div className="space-y-5 p-5">
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-zinc-100 ring-1 ring-inset ring-zinc-200/60 dark:bg-zinc-800 dark:ring-zinc-700/40">
              {bucketTotal > 0
                ? BUCKETS.map((b) => {
                    const value = Math.max(0, s[b.key]);
                    if (value <= 0) return null;
                    return (
                      <div
                        key={b.key}
                        className={`${b.bar} h-full first:rounded-l-full last:rounded-r-full`}
                        style={{ width: `${(value / bucketTotal) * 100}%` }}
                        title={`${b.label}: ${formatINR(value, false)}`}
                      />
                    );
                  })
                : <div className="h-full w-full bg-zinc-200/60 dark:bg-zinc-700/40" />}
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
              {BUCKETS.map((b) => {
                const value = Math.max(0, s[b.key]);
                const pct = bucketTotal > 0 ? (value / bucketTotal) * 100 : 0;
                return (
                  <div key={b.key} className={`rounded-xl border p-3 ${b.tile}`}>
                    <div className="flex items-center gap-1.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                      <span className={`h-1.5 w-1.5 rounded-full ${b.dot}`} />
                      {b.label}
                    </div>
                    <div className={`mt-1.5 text-sm font-semibold tabular-nums ${b.text}`}>{formatINR(value)}</div>
                    <div className="mt-0.5 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">{pct.toFixed(1)}% of past due</div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-4 dark:border-zinc-800/60">
              <MiniStat label="Above 90 days" value={formatINR(s.above90Total, false)} />
              <MiniStat label="Avg receivable / customer" value={formatINR(avgReceivable, false)} />
              <MiniStat label="Invoices" value={String(s.invoiceCount)} />
              <MiniStat label="Customers" value={String(s.customerCount)} />
            </div>
          </div>
        </Card>

        <PromiseOverview customers={customers} asOfIST={asOfIST} />
      </section>

      <section className="relative space-y-4 border-t border-zinc-200/80 pt-8 dark:border-zinc-800/80">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-300/70 to-transparent dark:via-zinc-700/70" />
        <SectionHeading
          eyebrow="Collections"
          title="Receipts & daily pace"
          description="Money received against invoices — totals, latest activity and the daily collection rhythm."
          accent="emerald"
          icon="collections"
          right={
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
                {collections.length} receipt{collections.length === 1 ? "" : "s"}
              </span>
              {latestCollectionDate && (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-medium text-emerald-700 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                  Latest {shortDate(latestCollectionDate)}
                </span>
              )}
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Collected this month" value={formatINR(thisMonth)} hint={new Date(`${asOfIST}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })} emphasis />
          <MetricCard label="Last 7 days" value={formatINR(last7)} hint={last7 === 0 ? "No receipts in this window" : "By collection date"} />
          <MetricCard label="Collected today" value={formatINR(today)} hint={shortDate(asOfIST)} />
          <MetricCard label="Unmatched / advances" value={`${unmatched} / ${advanceCount}`} hint="Unmatched receipts / advance receipts" accent={unmatched > 0 ? "amber" : "zinc"} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800/70">
              <div>
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Daily collections</h3>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  Last 14 days by collection date · against previous bill vs advances
                  {latestCollectionDate ? ` · latest receipt ${shortDate(latestCollectionDate)}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-emerald-500" />
                    Against previous bill
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-violet-500" />
                    Advances
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">Last 7 days</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatINR(last7, false)}</div>
              </div>
            </div>

            <div className="p-5">
              {collections.length === 0 ? (
                <EmptyState title="No collections recorded yet" hint="Paste the receipts sheet from the Accounts tab to see the daily collection trend here." />
              ) : (
                <div className="flex h-48 items-end gap-1.5 overflow-x-auto pb-1">
                  {days.map((day) => {
                    const v = daily.get(day);
                    const total = v?.total || 0;
                    const regular = v?.regular || 0;
                    const advance = v?.advance || 0;
                    const height = total > 0 ? Math.max(6, (total / maxDaily) * 100) : 1.5;
                    const advanceShare = total > 0 ? (advance / total) * 100 : 0;
                    const regularShare = Math.max(0, 100 - advanceShare);
                    const active = day === asOfIST;
                    return (
                      <div
                        key={day}
                        className="flex min-w-[38px] flex-1 flex-col items-center justify-end gap-1.5 self-stretch"
                        title={`${shortDate(day)}: ${formatINR(total, false)} total · ${formatINR(regular, false)} previous bill · ${formatINR(advance, false)} advances · ${v?.count || 0} receipt${(v?.count || 0) === 1 ? "" : "s"}`}
                      >
                        <span className={`text-[9px] tabular-nums ${total > 0 ? "font-medium text-zinc-500 dark:text-zinc-400" : "text-transparent"}`}>
                          {formatCompactINR(total) || "0"}
                        </span>
                        <div className={`flex w-full flex-1 items-end rounded-lg px-1 ${active ? "bg-emerald-50/80 ring-1 ring-inset ring-emerald-200/70 dark:bg-emerald-950/20 dark:ring-emerald-900/50" : "bg-zinc-50/80 dark:bg-zinc-950/30"}`}>
                          <div className="w-full overflow-hidden rounded-t-md" style={{ height: `${height}%` }}>
                            {total > 0 ? (
                              <div className="flex h-full w-full flex-col-reverse">
                                <div
                                  className={`${active ? "bg-gradient-to-t from-emerald-600 to-emerald-400" : "bg-gradient-to-t from-emerald-600/80 to-emerald-400/80 hover:from-emerald-600 hover:to-emerald-400"} transition-colors`}
                                  style={{ height: `${regularShare}%` }}
                                />
                                {advance > 0 && (
                                  <div
                                    className={`${active ? "bg-gradient-to-t from-violet-600 to-violet-400" : "bg-gradient-to-t from-violet-600/85 to-violet-400/85 hover:from-violet-600 hover:to-violet-400"} transition-colors`}
                                    style={{ height: `${advanceShare}%` }}
                                  />
                                )}
                              </div>
                            ) : (
                              <div className="h-full w-full bg-zinc-200 dark:bg-zinc-800" />
                            )}
                          </div>
                        </div>
                        <span className={`text-[9px] tabular-nums ${active ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"}`}>
                          {dayLabel(day)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          <Card className="flex flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800/70">
              <div>
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Advance vs previous bill</h3>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  Receipts with “advance” in the remarks vs collections against previous bills, this week and this month
                </p>
              </div>
              <span className="whitespace-nowrap rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300">
                {previousCount} previous bill · {advanceCount} advance{advanceCount === 1 ? "" : "s"}
              </span>
            </div>

            <div className="grid flex-1 grid-cols-2 border-t border-zinc-200/80 dark:border-zinc-800">
              <AdvanceQuadrant
                bucket="previousWeek"
                category="Against Previous Bill"
                period="This week"
                value={advanceSplit.previousWeek.amount}
                count={advanceSplit.previousWeek.count}
                className="border-b border-r border-zinc-200/80 dark:border-zinc-800"
              />
              <AdvanceQuadrant
                bucket="previousMonth"
                category="Against Previous Bill"
                period="This month"
                value={advanceSplit.previousMonth.amount}
                count={advanceSplit.previousMonth.count}
                className="border-b border-zinc-200/80 dark:border-zinc-800"
              />
              <AdvanceQuadrant
                bucket="advanceWeek"
                category="Advance"
                period="This week"
                value={advanceSplit.advanceWeek.amount}
                count={advanceSplit.advanceWeek.count}
                className="border-r border-zinc-200/80 dark:border-zinc-800"
              />
              <AdvanceQuadrant
                bucket="advanceMonth"
                category="Advance"
                period="This month"
                value={advanceSplit.advanceMonth.amount}
                count={advanceSplit.advanceMonth.count}
              />
            </div>
            <ReceiptAgeingMini split={receiptAgeing} />
          </Card>
        </div>
      </section>
    </div>
  );
}
