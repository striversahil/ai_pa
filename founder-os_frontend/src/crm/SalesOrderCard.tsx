// SalesOrderCard — one sales-dispatch row (extracted verbatim from
// components/SalesDispatchPanel.tsx; the panel keeps state + buckets).
import React from "react";
import { AlertTriangle, CalendarClock, Wallet } from "lucide-react";
import type { PanelMode } from "./OrderPanel";
import type { CrmOrder, SalesBucket } from "./types";
import { LIFECYCLE_META } from "./types";
import { earliestCommittedDate, orderFlags } from "./queue";
import { CARD, NUM, PILL } from "@/components/telecalling/surface";
import { inrWhole as inr } from "@/lib/format";

/** "26 Oct 2026" — dates on the cards carry their year, like the SO panel. */
const dayLabel = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

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

export function SalesOrderCard({
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

/** Cards are memoised (same reason as the dispatch floor's OrderCard): a
 *  live-event refetch must not redo every card's item filters. */
export const MemoSalesOrderCard = React.memo(SalesOrderCard);

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
