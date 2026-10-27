"use client";

import type { ReactNode } from "react";
import type { LiveCollection, SummaryRow } from "@/payment-tracker/types";
import { formatINR, hasBillReference, isAdvancePayment, shortDate } from "@/payment-tracker/types";
import { Card, EmptyState, MiniStat } from "../ui";

const BUCKETS = [
  { key: "bucket0to30", label: "0–30 Days", bar: "bg-emerald-500", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", tile: "border-emerald-100 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/15" },
  { key: "bucket31to60", label: "31–60 Days", bar: "bg-lime-500", dot: "bg-lime-500", text: "text-lime-700 dark:text-lime-400", tile: "border-lime-100 bg-lime-50/40 dark:border-lime-900/40 dark:bg-lime-950/15" },
  { key: "bucket61to90", label: "61–90 Days", bar: "bg-amber-500", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", tile: "border-amber-100 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/15" },
  { key: "bucket91to180", label: "91–180 Days", bar: "bg-orange-500", dot: "bg-orange-500", text: "text-orange-700 dark:text-orange-400", tile: "border-orange-100 bg-orange-50/40 dark:border-orange-900/40 dark:bg-orange-950/15" },
  { key: "bucketAbove180", label: "Above 180 Days", bar: "bg-rose-500", dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400", tile: "border-rose-100 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/15" },
] as const;

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

function compactINR(n: number): string {
  if (n <= 0) return "";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${Math.round(n / 1e3)}k`;
  return `₹${Math.round(n)}`;
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

function AdvanceStat({
  label, value, count,
}: {
  label: string;
  value: number;
  count: number;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-sky-100 bg-sky-50/30 px-3 py-2.5 dark:border-sky-900/50 dark:bg-sky-950/15">
      <div className="absolute inset-y-0 left-0 w-1 bg-sky-500" />
      <div className="pl-2">
        <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-sky-700/80 dark:text-sky-300/80">{label}</div>
        <div className="mt-1 text-lg font-semibold leading-none tabular-nums tracking-tight text-sky-700 dark:text-sky-300">{formatINR(value)}</div>
        <div className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">{count} receipt{count === 1 ? "" : "s"}</div>
      </div>
    </div>
  );
}

export default function SummaryTab({
  summary, collections, asOfIST,
}: {
  summary: SummaryRow;
  collections: LiveCollection[];
  asOfIST: string;
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
    billWeek: { amount: 0, count: 0 },
    billMonth: { amount: 0, count: 0 },
    noBillWeek: { amount: 0, count: 0 },
    noBillMonth: { amount: 0, count: 0 },
  };
  for (const c of collections) {
    if (!isAdvancePayment(c)) continue;
    const day = c.collectionDate || "";
    const amount = Number(c.amount) || 0;
    const inWeek = day >= weekStart && day <= asOfIST;
    const inMonth = day.startsWith(monthPrefix);
    if (hasBillReference(c)) {
      if (inWeek) { advanceSplit.billWeek.amount += amount; advanceSplit.billWeek.count++; }
      if (inMonth) { advanceSplit.billMonth.amount += amount; advanceSplit.billMonth.count++; }
    } else {
      if (inWeek) { advanceSplit.noBillWeek.amount += amount; advanceSplit.noBillWeek.count++; }
      if (inMonth) { advanceSplit.noBillMonth.amount += amount; advanceSplit.noBillMonth.count++; }
    }
  }
  const today = sumAmounts(collections.filter((c) => c.collectionDate === asOfIST));
  const unmatched = collections.filter((c) => c.matchStatus === "none").length;
  const advances = collections.filter(isAdvancePayment).length;
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
    if (isAdvancePayment(c)) {
      cur.advance += amount;
    } else {
      cur.regular += amount;
    }
  }
  const maxDaily = Math.max(1, ...days.map((d) => daily.get(d)?.total || 0));

  const modeTotals = new Map<string, { amount: number; count: number }>();
  for (const c of collections) {
    const mode = (c.mode || "Unspecified").trim() || "Unspecified";
    if (!modeTotals.has(mode)) modeTotals.set(mode, { amount: 0, count: 0 });
    const cur = modeTotals.get(mode)!;
    cur.amount += Number(c.amount) || 0;
    cur.count += 1;
  }
  const modes = [...modeTotals.entries()].sort((a, b) => b[1].amount - a[1].amount);
  const maxMode = Math.max(1, ...modes.map(([, v]) => v.amount));

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
          <MetricCard label="Unmatched / advances" value={`${unmatched} / ${advances}`} hint="Unmatched receipts / advance payment receipts" accent={unmatched > 0 ? "amber" : "zinc"} />
        </div>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800/70">
            <div>
              <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Advance payments</h3>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                Advance receipts split by bill linkage · month to date and Monday → today
              </p>
            </div>
            <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300">
              {advances} advance receipt{advances === 1 ? "" : "s"}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
            <AdvanceStat label="Against bill · This week" value={advanceSplit.billWeek.amount} count={advanceSplit.billWeek.count} />
            <AdvanceStat label="Against bill · This month" value={advanceSplit.billMonth.amount} count={advanceSplit.billMonth.count} />
            <AdvanceStat label="Without bill · This week" value={advanceSplit.noBillWeek.amount} count={advanceSplit.noBillWeek.count} />
            <AdvanceStat label="Without bill · This month" value={advanceSplit.noBillMonth.amount} count={advanceSplit.noBillMonth.count} />
          </div>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800/70">
              <div>
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Daily collections</h3>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  Last 14 days by collection date · regular receipts vs client advances
                  {latestCollectionDate ? ` · latest receipt ${shortDate(latestCollectionDate)}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-emerald-500" />
                    Collections
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-sky-500" />
                    Client advances
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
                    const active = day === asOfIST;
                    return (
                      <div
                        key={day}
                        className="flex min-w-[38px] flex-1 flex-col items-center justify-end gap-1.5 self-stretch"
                        title={`${shortDate(day)}: ${formatINR(total, false)} total · ${formatINR(regular, false)} collections · ${formatINR(advance, false)} advances · ${v?.count || 0} receipt${(v?.count || 0) === 1 ? "" : "s"}`}
                      >
                        <span className={`text-[9px] tabular-nums ${total > 0 ? "font-medium text-zinc-500 dark:text-zinc-400" : "text-transparent"}`}>
                          {compactINR(total) || "0"}
                        </span>
                        <div className={`flex w-full flex-1 items-end rounded-lg px-1 ${active ? "bg-emerald-50/80 ring-1 ring-inset ring-emerald-200/70 dark:bg-emerald-950/20 dark:ring-emerald-900/50" : "bg-zinc-50/80 dark:bg-zinc-950/30"}`}>
                          <div className="w-full overflow-hidden rounded-t-md" style={{ height: `${height}%` }}>
                            {total > 0 ? (
                              <div className="flex h-full w-full flex-col-reverse">
                                <div
                                  className={`${active ? "bg-gradient-to-t from-emerald-600 to-emerald-400" : "bg-gradient-to-t from-emerald-600/80 to-emerald-400/80 hover:from-emerald-600 hover:to-emerald-400"} transition-colors`}
                                  style={{ height: `${100 - advanceShare}%` }}
                                />
                                {advance > 0 && (
                                  <div
                                    className={`${active ? "bg-gradient-to-t from-sky-600 to-sky-400" : "bg-gradient-to-t from-sky-600/85 to-sky-400/85 hover:from-sky-600 hover:to-sky-400"} transition-colors`}
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
            <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800/70">
              <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Collection mix</h3>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Receipts grouped by payment mode</p>
            </div>

            <div className="flex-1 space-y-4 p-5">
              {modes.length === 0 ? (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">No payment modes recorded yet.</p>
              ) : (
                modes.map(([mode, v]) => (
                  <div key={mode} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate font-medium text-zinc-600 dark:text-zinc-300">{mode}</span>
                      <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">{formatINR(v.amount)} · {v.count}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sky-500/80 to-emerald-500/80"
                        style={{ width: `${(Math.max(0, v.amount) / maxMode) * 100}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-zinc-100 bg-zinc-50/60 px-5 py-4 dark:border-zinc-800/70 dark:bg-zinc-950/30">
              <MiniStat label="Unmatched" value={String(unmatched)} />
              <MiniStat label="Advances" value={String(advances)} />
              <MiniStat label="This month" value={formatINR(thisMonth, false)} />
              <MiniStat label="Today" value={formatINR(today, false)} />
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
