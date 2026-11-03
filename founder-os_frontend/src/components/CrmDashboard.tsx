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
import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  Package,
  RefreshCw,
  Search,
  Trash2,
  Truck,
  type LucideIcon,
} from "lucide-react";
import OrderPanel, { type PanelMode } from "@/crm/OrderPanel";
import { istToday, useCrmOrders, useCrmSummary } from "@/crm/hooks";
import { LIFECYCLE_META, type CrmOrder, type View } from "@/crm/types";
import { earliestCommittedDate, orderFlags } from "@/crm/queue";
import { isOverdueItem } from "@/crm/lifecycle";

const inr = (n: number | null | undefined) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const dayLabel = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

const daysBetween = (from: string, to: string) => {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
};

const TABS: Array<{ key: View; label: string; icon: LucideIcon }> = [
  { key: "dispatch-floor", label: "Dispatch Floor", icon: Truck },
  { key: "unscheduled", label: "Schedule", icon: CalendarClock },
  { key: "scheduled", label: "Scheduled", icon: Clock },
  { key: "dispatched", label: "Dispatched", icon: CheckCircle2 },
  { key: "source-deleted", label: "Source Deleted", icon: Trash2 },
  { key: "all", label: "All SOs", icon: Package },
];

export default function CrmDashboard() {
  const today = istToday();
  const [view, setView] = useState<View>("dispatch-floor");
  const [q, setQ] = useState("");
  const [panel, setPanel] = useState<{ order: CrmOrder; mode: PanelMode } | null>(null);

  const list = useCrmOrders(view, q);
  const summary = useCrmSummary();

  const orders = list.data?.orders ?? [];
  const counts = summary.data?.counts;

  const badges = useMemo<Record<View, number>>(
    () => ({
      "dispatch-floor": (counts?.floorToday ?? 0) + (counts?.overdue ?? 0),
      unscheduled: (counts?.unscheduled ?? 0) + (counts?.partiallyScheduled ?? 0),
      scheduled: counts?.scheduled ?? 0,
      dispatched: (counts?.partiallyDispatched ?? 0) + (counts?.dispatched ?? 0),
      "source-deleted": counts?.deletedSource ?? 0,
      all: counts?.total ?? 0,
    }),
    [counts],
  );

  const openPanel = (order: CrmOrder, mode: PanelMode) => setPanel({ order, mode });

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-6 text-zinc-900 md:px-8 dark:text-zinc-100">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dispatch Floor</h1>
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
            onClick={list.refresh}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${list.loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Due today" value={counts?.floorToday ?? 0} accent="text-indigo-600 dark:text-indigo-400" icon={Truck} />
        <Kpi label="Overdue" value={counts?.overdue ?? 0} accent="text-rose-600 dark:text-rose-400" icon={AlertTriangle} />
        <Kpi label="Unscheduled" value={counts?.unscheduled ?? 0} accent="text-red-600 dark:text-red-400" icon={CalendarClock} />
        <Kpi label="Partially sched." value={counts?.partiallyScheduled ?? 0} accent="text-amber-600 dark:text-amber-400" icon={Clock} />
        <Kpi label="Scheduled" value={counts?.scheduled ?? 0} accent="text-sky-600 dark:text-sky-400" icon={CalendarClock} />
        <Kpi label="Dispatched" value={counts?.dispatched ?? 0} accent="text-emerald-600 dark:text-emerald-400" icon={CheckCircle2} />
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
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="SO number, customer, salesperson…"
            className="w-64 rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-xs outline-none focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900/60"
          />
        </div>
      </div>
      {!!list.error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
          Could not load the floor: {String((list.error as any)?.message || list.error)}
        </div>
      )}

      {list.loading && orders.length === 0 && <SkeletonList />}

      {!list.loading && orders.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {view === "dispatch-floor"
            ? "Nothing due today. Schedule the red orders so work shows up here."
            : view === "source-deleted"
              ? "No orders were dropped by Zoho. Nothing to confirm."
              : "No orders in this view."}
        </div>
      )}

      <div className="space-y-2.5">
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} today={today} view={view} onOpen={openPanel} />
        ))}
      </div>

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
        />
      )}
    </div>
  );
}

// ── Cards ───────────────────────────────────────────────────────────────────

function OrderCard({
  order,
  today,
  view,
  onOpen,
}: {
  order: CrmOrder;
  today: string;
  view: View;
  onOpen: (order: CrmOrder, mode: PanelMode) => void;
}) {
  const items = order.items || [];
  const meta = LIFECYCLE_META[order.lifecycle] ?? LIFECYCLE_META.unscheduled;
  const flags = orderFlags(order, today);
  const scheduled = items.filter((it) => it.dispatchState === "scheduled").length;
  const dispatched = items.filter((it) => it.dispatchState === "dispatched").length;
  const blocked = items.filter((it) => it.dispatchState === "unscheduled" && it.delayReason).length;
  const overdueItems = items.filter((it) => isOverdueItem(it, today));
  const committed = earliestCommittedDate(items);
  const overdueDays = overdueItems.length ? daysBetween(String(overdueItems[0].tentativeDispatchDate), today) : 0;

  return (
    <div
      className={`group rounded-2xl border bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md dark:bg-zinc-900/60 ${
        order.overdue
          ? "border-rose-300 dark:border-rose-500/40"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">{order.soNumber}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.chip}`}>{meta.label}</span>
            {order.overdue && (
              <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                {overdueItems.length} item{overdueItems.length === 1 ? "" : "s"} overdue{overdueDays ? ` · ${overdueDays}d` : ""}
              </span>
            )}
            {order.sourceState === "deleted_source" && (
              <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                Deleted at source
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-300">
            {order.customerName || "—"}
            <span className="text-zinc-400"> · </span>
            {order.salesperson || "Unassigned"}
            {order.referenceNumber ? (
              <>
                <span className="text-zinc-400"> · </span>ref {order.referenceNumber}
              </>
            ) : null}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">{inr(order.value)}</div>
          <div className="text-[10px] text-zinc-500">
            {items.length} item{items.length === 1 ? "" : "s"}
            {committed ? ` · committed ${dayLabel(committed)}` : ""}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
        <Pill tone="sky" label={`${scheduled}/${items.length} scheduled`} />
        <Pill tone="emerald" label={`${dispatched}/${items.length} dispatched`} />
        {blocked > 0 && <Pill tone="amber" label={`${blocked} blocked`} />}
        {order.dueToday ? <Pill tone="indigo" label={`${order.dueToday} out today`} /> : null}
        {order.soDelayReason && (
          <span className="truncate text-amber-600 dark:text-amber-400" title={order.soDelayReason}>
            {order.soDelayReason}
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {flags.canSchedule && (
          <ActionButton icon={CalendarClock} label={order.lifecycle === "unscheduled" ? "Schedule" : "Finish scheduling"} onClick={() => onOpen(order, "schedule")} primary />
        )}
        {flags.canDispatch && (
          <ActionButton icon={Truck} label={order.overdue ? "Dispatch / reschedule" : "Dispatch"} onClick={() => onOpen(order, order.overdue ? "reschedule" : "dispatch")} />
        )}
        {order.sourceState === "deleted_source" && (
          <ActionButton icon={Trash2} label="Review & confirm" onClick={() => onOpen(order, "view")} danger />
        )}
        <button
          onClick={() => onOpen(order, "view")}
          className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          Open <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function Pill({ tone, label }: { tone: "sky" | "emerald" | "amber" | "indigo"; label: string }) {
  const tones = {
    sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  } as const;
  return <span className={`rounded-full px-2 py-0.5 font-semibold ${tones[tone]}`}>{label}</span>;
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  primary,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  const cls = primary
    ? "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm"
    : danger
      ? "border border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-400 dark:hover:bg-rose-500/10"
      : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function Kpi({ label, value, accent, icon: Icon }: { label: string; value: number; accent: string; icon: LucideIcon }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</span>
        <Icon className={`h-3.5 w-3.5 ${accent}`} />
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
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
