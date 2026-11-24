"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CrmDashboard — the dispatch floor.
//
// Replaces the old department-desk control room (Overview / CRM Desk / Accounts
// / Dispatch / Procurement). The floor is ONE flow:
//
//   new SO → Unscheduled (red) → Schedule → Scheduled → Dispatch → Dispatched
//                                  ↘ partially scheduled   ↘ partially dispatched
//                                  ↘ reschedule (mandatory reason) when a date slips
//
// Tabs are workflow states, never Zoho statuses: Accounts / procurement data
// survives as search inside "All SOs". Everything here is a view over D1 rows
// synced from Zoho Books — Zoho stays read-only.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Package,
  RefreshCw,
  Search,
  Trash2,
  Truck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import OrderPanel, { type PanelMode } from "@/crm/OrderPanel";
import { MemoOrderCard } from "@/crm/OrderCard";
import { istToday, useCrmOrders, useCrmSummary } from "@/crm/hooks";
import type { CrmOrder, View } from "@/crm/types";
import { ChangesBanner, Pager } from "@/components/ui";



const TABS: Array<{ key: View; label: string; icon: LucideIcon }> = [
  { key: "dispatch-floor", label: "Today's Dispatches", icon: Truck },
  { key: "unscheduled", label: "To Schedule", icon: CalendarClock },
  { key: "scheduled", label: "Scheduled", icon: Clock },
  { key: "dispatched", label: "Dispatched", icon: CheckCircle2 },
  { key: "cancelled", label: "Cancelled", icon: XCircle },
  { key: "source-deleted", label: "Source Deleted", icon: Trash2 },
  { key: "all", label: "All SOs", icon: Package },
];

export default function CrmDashboard() {
  const today = istToday();
  const [view, setView] = useState<View>("dispatch-floor");
  const [panel, setPanel] = useState<{ order: CrmOrder; mode: PanelMode } | null>(null);

  // 50 per page + server search over every order (Today's Dispatches is
  // never paged — the server returns all of it on page 1).
  const list = useCrmOrders(view);
  const summary = useCrmSummary();

  const orders = list.rows;
  const counts = summary.data?.counts;

  const badges = useMemo<Record<View, number>>(
    () => ({
      // The badge is the server's floor UNION (due today OR overdue) — the same
      // predicate the list renders — never floorToday + overdue.
      "dispatch-floor": counts?.tabFloor ?? 0,
      // Tab membership is per ITEM (see crm/queue.ts), so these come from the
      // server's tab totals — never from the lifecycle buckets, which would
      // hide a partially dispatched order that still has undated items.
      unscheduled: counts?.tabUnscheduled ?? 0,
      scheduled: counts?.tabScheduled ?? 0,
      dispatched: counts?.tabDispatched ?? 0,
      cancelled: counts?.tabCancelled ?? 0,
      "source-deleted": counts?.deletedSource ?? 0,
      all: counts?.total ?? 0,
      // Unified Sales buckets are not tabs here, but the View-keyed map stays
      // exhaustive so adding a view can never silently drop a badge.
      incomplete: counts?.incomplete ?? 0,
      completed: counts?.completed ?? 0,
    }),
    [counts],
  );

  const openPanel = (order: CrmOrder, mode: PanelMode) => setPanel({ order, mode });

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-6 text-zinc-900 md:px-8 dark:text-zinc-100">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Today&apos;s Dispatches</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Every sales order from Zoho Books, scheduled and dispatched from here. New orders land red — nothing ships until it is dated.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live · {today}
          </div>
          <button
            onClick={() => { list.refresh(); summary.refresh(); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${list.loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>
      {/* A card whose stage HAS a tab reads that tab's total, so the number
          always equals the SOs the list renders. The lifecycle buckets are
          pipeline stages that overlap (one SO sits in several tabs), so they
          never back a card; "Partially sched." is the one stage without a tab. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Due today" value={counts?.floorToday ?? 0} hint={itemHint(counts?.dueTodayItems)} accent="text-indigo-600 dark:text-indigo-400" icon={Truck} />
        <Kpi label="Overdue" value={counts?.overdue ?? 0} hint={itemHint(counts?.overdueItems)} accent="text-rose-600 dark:text-rose-400" icon={AlertTriangle} />
        <Kpi label="Unscheduled" value={counts?.tabUnscheduled ?? 0} accent="text-red-600 dark:text-red-400" icon={CalendarClock} />
        <Kpi label="Partially sched." value={counts?.partiallyScheduled ?? 0} title="Mixed stage: some lines are dated or dispatched while others are still open, so these SOs also appear in the other tabs." accent="text-amber-600 dark:text-amber-400" icon={Clock} />
        <Kpi label="Scheduled" value={counts?.tabScheduled ?? 0} accent="text-sky-600 dark:text-sky-400" icon={CalendarClock} />
        <Kpi label="Dispatched" value={counts?.tabDispatched ?? 0} accent="text-emerald-600 dark:text-emerald-400" icon={CheckCircle2} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                view === key
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {badges[key] > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                    view === key ? "bg-white/20" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {badges[key]}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
          <input
            value={list.q}
            onChange={(e) => list.setQ(e.target.value)}
            placeholder="SO number, customer, salesperson…"
            className="w-64 rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-xs outline-none focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900/60"
          />
        </div>
      </div>
      {!!list.error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
          Could not load the floor: {list.error instanceof Error ? list.error.message : String(list.error)}
        </div>
      )}

      <ChangesBanner count={list.changes} onRefresh={list.refresh} />

      {list.loading && orders.length === 0 && <SkeletonList />}

      {!list.loading && orders.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {view === "dispatch-floor"
            ? "Nothing due today. Schedule the red orders so work shows up here."
            : view === "cancelled"
              ? "No cancelled orders — full SO cancels and unavailable-line cancels land here."
              : view === "source-deleted"
                ? "No orders were dropped by Zoho. Nothing to confirm."
                : "No orders in this view."}
        </div>
      )}

      <div className="space-y-2.5">
        {orders.map((order) => (
          <MemoOrderCard key={order.id} order={order} today={today} view={view} onOpen={openPanel} />
        ))}
      </div>

      {list.total > 0 && (
        <Pager page={list.page} limit={list.limit} total={list.total} totalPages={list.totalPages} onPage={list.setPage} noun="orders" />
      )}

      {panel && (
        <OrderPanel
          order={panel.order}
          initialMode={panel.mode}
          canWrite
          onClose={() => setPanel(null)}
          onChanged={() => {
            list.refresh();
            summary.refresh();
          }}
          invoiceGate={list.data?.viewer?.invoiceGate ?? "enforce"}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, hint, title, accent, icon: Icon }: { label: string; value: number; hint?: string; title?: string; accent: string; icon: LucideIcon }) {
  return (
    <div title={title} className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</span>
        <Icon className={`h-3.5 w-3.5 ${accent}`} />
      </div>
      <div className={`mt-1 flex items-baseline gap-1.5 text-xl font-semibold tabular-nums ${accent}`}>
        {value}
        {hint && <span className="text-[10px] font-medium tabular-nums text-zinc-400 dark:text-zinc-500">{hint}</span>}
      </div>
    </div>
  );
}

/** Orders stay the headline (one card = one order, like every other KPI);
 *  this is the item count the order pills show, so a two-line order reads
 *  "1 · 2 items" instead of a number that looks too small. */
function itemHint(items?: number): string | undefined {
  if (!items || items <= 0) return undefined;
  return `${items} item${items === 1 ? "" : "s"}`;
}

function SkeletonList() {
  return (
    <div className="space-y-2.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[104px] animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/40" />
      ))}
    </div>
  );
}
