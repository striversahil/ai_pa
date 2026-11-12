"use client";

// SalesDispatchPanel — the sales team's side of the dispatch floor.
//
// The old CRM dashboard is the floor's full workflow (schedule → dispatch →
// confirm removals). Sales needs a narrower question: "which of MY region's
// orders are still owed, and which are done?" So this panel is two buckets:
//
//   Incomplete — everything still owed: undated → dated → dispatched, right up
//                until the payment process completes.
//   Completed  — paid in full (Zoho `paid_status = paid`, or a closed order
//                with nothing outstanding).
//
// Region ownership is SERVER-side: an agent is locked to the region on their
// roster row and may only set tentative dispatch dates (the promise) on those
// orders. Root / sales-head see every region and can filter with chips.
// Dispatching, rescheduling and removals stay with the dispatch floor.
import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Package,
  RefreshCw,
  Search,
  Truck,
  Wallet,
} from "lucide-react";
import OrderPanel, { type PanelMode } from "@/crm/OrderPanel";
import { istToday, useCrmOrders, useCrmSummary } from "@/crm/hooks";
import type { CrmOrder, SalesBucket } from "@/crm/types";
import { LIFECYCLE_META } from "@/crm/types";
import { earliestCommittedDate, orderFlags } from "@/crm/queue";
import { REGIONS } from "@/telecalling/regions";
import { TabBar } from "@/components/ui";
import { BTN, CARD, LABEL, NUM, PILL } from "@/components/telecalling/surface";
import { inrWhole as inr } from "@/lib/format";



/** "26 Oct 2026" — dates on the cards carry their year, like the SO panel. */
const dayLabel = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const regionName = (id: string) => REGIONS.find((r) => r.id === id)?.name ?? "";

/** Payment stage chip — the "completed" boundary must be obvious at a glance. */
function paymentChip(order: CrmOrder): { label: string; cls: string } {
  const paid = String(order.paidStatus || "").toLowerCase();
  const orderStatus = String(order.orderStatus || "").toLowerCase();
  if (paid === "paid") return { label: "Paid", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" };
  if (paid === "partially_paid") return { label: "Partially paid", cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" };
  if (orderStatus === "closed") return { label: "Closed · payment outstanding", cls: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400" };
  if (String(order.invoicedStatus || "").toLowerCase() === "invoiced") return { label: "Invoiced · unpaid", cls: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400" };
  return { label: "Unpaid", cls: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400" };
}

export default function SalesDispatchPanel() {
  const today = istToday();
  const [bucket, setBucket] = useState<SalesBucket>("incomplete");
  const [region, setRegion] = useState("");
  const [q, setQ] = useState("");
  const [panel, setPanel] = useState<{ order: CrmOrder; mode: PanelMode } | null>(null);

  const list = useCrmOrders(bucket, q, region);
  const summary = useCrmSummary(region);

  const viewer = list.data?.viewer ?? summary.data?.viewer;
  const isManager = !!viewer?.isManager;
  const canPromise = !!viewer?.canPromise;
  const counts = summary.data?.counts;
  const orders = list.data?.orders ?? [];
  const regionCounts = counts?.regions ?? {};

  const chips = useMemo<Array<{ key: string; label: string; count: number }>>(() => {
    const items: Array<{ key: string; label: string; count: number }> = [
      {
        key: "",
        label: "All regions",
        count: REGIONS.reduce((sum, r) => sum + (regionCounts[r.id]?.[bucket] ?? 0), 0) + (regionCounts[""]?.[bucket] ?? 0),
      },
      ...REGIONS.map((r) => ({ key: r.id, label: r.id, count: regionCounts[r.id]?.[bucket] ?? 0 })),
    ];
    const unmapped = regionCounts[""]?.[bucket] ?? 0;
    if (unmapped > 0) items.push({ key: "unmapped", label: "Unmapped", count: unmapped });
    return items;
  }, [regionCounts, bucket]);

  const openPanel = (order: CrmOrder, mode: PanelMode) => setPanel({ order, mode });

  if (viewer && !isManager && !viewer.region) {
    return (
      <div className={`${CARD} p-8 text-center`}>
        <p className="text-sm font-semibold text-[var(--text-primary)]">No sales region is mapped to your login</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-[var(--text-secondary)]">
          Dispatch is region-owned. Ask the sales-head to map you to R1–R4 on the telecalling roster, then refresh.
        </p>
      </div>
    );
  }

  const regionControls: React.ReactNode = isManager ? (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => {
        const activeChip = region === chip.key;
        return (
          <button
            key={chip.key || "all"}
            type="button"
            onClick={() => setRegion(chip.key)}
            title={chip.key && chip.key !== "unmapped" ? regionName(chip.key) : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
              activeChip
                ? "border-transparent bg-[var(--color-brand-indigo)] text-white"
                : "border-[var(--border-card)] bg-[var(--surface-sunken)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {chip.label}
            <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${activeChip ? "bg-white/25 text-white" : "bg-[var(--surface-soft)] text-[var(--text-tertiary)]"}`}>
              {chip.count}
            </span>
          </button>
        );
      })}
    </div>
  ) : (
    <p className="text-[11px] font-semibold text-[var(--text-tertiary)]">
      Region · {viewer?.region} {regionName(viewer?.region || "")}
    </p>
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-bold tracking-tight text-[var(--text-primary)]">Dispatch</h2>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {isManager
              ? "Every region's sales orders in one place. Incomplete runs until payment is complete; completed means paid in full."
              : `Your region's sales orders (${viewer?.region || "—"}). Set the dispatch date the floor should work to.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`${PILL} border-[var(--border-card)] bg-[var(--surface-sunken)] text-[var(--text-tertiary)]`}>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live · {today}
          </span>
          <button onClick={() => { list.refresh(); summary.refresh(); }} className={BTN}>
            <RefreshCw className={`h-3.5 w-3.5 ${list.loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Incomplete" value={counts?.incomplete ?? 0} icon={Package} accent="text-amber-600 dark:text-amber-400" />
        <Kpi label="Completed" value={counts?.completed ?? 0} icon={CheckCircle2} accent="text-emerald-600 dark:text-emerald-400" />
        <Kpi label="Due today" value={counts?.floorToday ?? 0} icon={Truck} accent="text-indigo-600 dark:text-indigo-400" />
        <Kpi label="Overdue" value={counts?.overdue ?? 0} icon={AlertTriangle} accent="text-rose-600 dark:text-rose-400" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabBar
          ariaLabel="Dispatch buckets"
          items={[
            { key: "incomplete", label: "Incomplete", icon: "📦", count: counts?.incomplete ?? 0, tone: "danger" },
            { key: "completed", label: "Completed", icon: "✅", count: counts?.completed ?? 0 },
          ]}
          active={bucket}
          onChange={(k) => setBucket(k as SalesBucket)}
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="SO number, customer, EST no…"
            className="w-64 rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Region chips — managers only. Agents are locked server-side. */}
      {regionControls}

      {!!list.error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
          Could not load dispatch: {String((list.error as any)?.message || list.error)}
        </div>
      )}

      {list.loading && orders.length === 0 && (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[104px] animate-pulse rounded-2xl border border-[var(--border-card)] bg-[var(--surface-sunken)]" />
          ))}
        </div>
      )}

      {!list.loading && orders.length === 0 && (
        <div className={`${CARD} p-10 text-center`}>
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {bucket === "completed" ? "Nothing completed yet" : "Nothing pending here"}
          </p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {bucket === "completed"
              ? "Orders appear here once Zoho shows them fully paid."
              : region
                ? `No incomplete orders in ${region === "unmapped" ? "the unmapped bucket" : region}.`
                : "No incomplete sales orders for this view."}
          </p>
        </div>
      )}

      <div className="space-y-2.5">
        {orders.map((order) => (
          <SalesOrderCard
            key={order.id}
            order={order}
            today={today}
            bucket={bucket}
            showRegion={isManager && !region}
            canPromise={canPromise}
            onOpen={openPanel}
          />
        ))}
      </div>

      {panel && (
        <OrderPanel
          order={panel.order}
          initialMode={panel.mode}
          canWrite={canPromise}
          promiseOnly={!viewer?.canWrite}
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

function SalesOrderCard({
  order,
  today,
  bucket,
  showRegion,
  canPromise,
  onOpen,
}: {
  order: CrmOrder;
  today: string;
  bucket: SalesBucket;
  showRegion: boolean;
  canPromise: boolean;
  onOpen: (order: CrmOrder, mode: PanelMode) => void;
}) {
  const items = order.items || [];
  const meta = LIFECYCLE_META[order.lifecycle] ?? LIFECYCLE_META.unscheduled;
  const flags = orderFlags(order, today);
  const scheduled = items.filter((it) => it.dispatchState === "scheduled").length;
  const dispatched = items.filter((it) => it.dispatchState === "dispatched").length;
  const committed = earliestCommittedDate(items);
  const payment = paymentChip(order);
  const canSetDates = canPromise && bucket === "incomplete" && items.some((it) => it.dispatchState !== "dispatched");

  return (
    <div className={`${CARD} p-3.5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(order, "view")}
            className="cursor-pointer border-0 bg-transparent p-0 font-mono text-sm font-semibold tracking-tight text-[var(--text-primary)] underline-offset-2 hover:text-indigo-600 hover:underline dark:hover:text-indigo-400"
            title="Open the full SO detail"
          >
            {order.soNumber}
          </button>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.chip}`}>{meta.label}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${payment.cls}`}>{payment.label}</span>
          {showRegion && (
            <span className="rounded-full border border-[var(--border-card)] bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-secondary)]">
              {order.region || "Unmapped"}
            </span>
          )}
          {order.overdue && (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-3 w-3" /> Overdue
            </span>
          )}
        </div>
        <div className="text-right">
          <div className={`${NUM} text-sm`}>{inr(order.value)}</div>
          <div className="text-[10px] text-[var(--text-tertiary)]">
            {items.length} item{items.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {/* Client on its own line — clicking it (like the SO number) opens the
          full detail. */}
      <button
        type="button"
        onClick={() => onOpen(order, "view")}
        className="mt-1.5 block w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left text-sm font-medium text-[var(--text-primary)] underline-offset-2 hover:text-indigo-600 hover:underline dark:hover:text-indigo-400"
        title="Open the full SO detail"
      >
        {order.customerName || "—"}
      </button>

      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--border-card)] pt-2.5 sm:grid-cols-4">
        <Fact label="SO date" value={dayLabel(order.createdDate)} />
        <Fact label="EST no." value={order.referenceNumber || "—"} mono />
        <Fact label="Salesperson" value={order.salesperson || "Unassigned"} />
        <Fact label="Region" value={order.region || "Unmapped"} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-secondary)]">
        <span className={`${PILL} border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400`}>{scheduled}/{items.length} dated</span>
        <span className={`${PILL} border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400`}>{dispatched}/{items.length} dispatched</span>
        {order.dueToday ? (
          <span className={`${PILL} border-indigo-500/25 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400`}>{order.dueToday} out today</span>
        ) : null}
        <span className={`${PILL} border-[var(--border-card)] bg-[var(--surface-sunken)] text-[var(--text-secondary)]`}>
          {committed ? `promised ${dayLabel(committed)}` : "no date yet"}
        </span>
        {order.soDelayReason && (
          <span className="truncate text-amber-600 dark:text-amber-400" title={order.soDelayReason}>
            {order.soDelayReason}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canSetDates && (
          <button
            onClick={() => onOpen(order, "schedule")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-brand-indigo)] px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:opacity-90"
          >
            <CalendarClock className="h-3.5 w-3.5" />
            {committed ? "Update dispatch date" : "Set dispatch date"}
          </button>
        )}
        {bucket === "incomplete" && flags.canDispatch && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
            <Wallet className="h-3 w-3" /> awaiting payment
          </span>
        )}
      </div>
    </div>
  );
}

/** One labelled fact on a card: muted label above the value. */
function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{label}</div>
      <div
        className={`mt-0.5 truncate text-[11px] font-medium text-[var(--text-primary)] ${mono ? "font-mono" : ""}`}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <div className={`${CARD} p-3`}>
      <div className="flex items-center justify-between">
        <span className={LABEL}>{label}</span>
        <Icon className={`h-3.5 w-3.5 ${accent}`} />
      </div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}
