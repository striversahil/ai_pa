// crm/OrderCard.tsx — one dispatch-floor sales order card (extracted verbatim
// from components/CrmDashboard.tsx; the dashboard keeps state + buckets).
import React from "react";
import {
  CalendarClock,
  Trash2,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { LIFECYCLE_META, type CrmOrder, type View } from "./types";
import type { PanelMode } from "./OrderPanel";
import { earliestCommittedDate, orderFlags } from "./queue";
import { isOverdueItem } from "./lifecycle";
import { inrWhole as inr } from "@/lib/format";

/** "26 Oct 2026" — dates on the cards carry their year, like the SO panel. */
const dayLabel = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const daysBetween = (from: string, to: string) => {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
};

export function OrderCard({
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
  const removedCount = items.filter((it) => (it as any)?.removedAt).length;

  return (
    <div
      className={`group rounded-2xl border bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md dark:bg-zinc-900/60 ${
        order.overdue
          ? "border-rose-300 dark:border-rose-500/40"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(order, "view")}
            className="cursor-pointer border-0 bg-transparent p-0 font-mono text-sm font-semibold tracking-tight text-zinc-900 underline-offset-2 hover:text-indigo-600 hover:underline dark:text-zinc-100 dark:hover:text-indigo-400"
            title="Open the full SO detail"
          >
            {order.soNumber}
          </button>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.chip}`}>{meta.label}</span>
          {order.lifecycle !== "cancelled" && removedCount > 0 && (
            <span
              className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
              title="Lines cancelled as unavailable — see the Cancelled tab"
            >
              {removedCount} line{removedCount === 1 ? "" : "s"} cancelled
            </span>
          )}
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
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">{inr(order.value)}</div>
          <div className="text-[10px] text-zinc-500">
            {items.length} item{items.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {/* Client — the one thing a person scans for, so it gets its own line,
          and clicking it (like the SO number) opens the full detail. */}
      <button
        type="button"
        onClick={() => onOpen(order, "view")}
        className="mt-1.5 block w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left text-sm font-medium text-zinc-800 underline-offset-2 hover:text-indigo-600 hover:underline dark:text-zinc-100 dark:hover:text-indigo-400"
        title="Open the full SO detail"
      >
        {order.customerName || "—"}
      </button>

      {/* The facts, each with its own label — no dot-separated run-on. */}
      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-zinc-100 pt-2.5 sm:grid-cols-4 dark:border-zinc-800">
        <Fact label="SO date" value={dayLabel(order.createdDate)} />
        <Fact label="EST no." value={order.referenceNumber || "—"} mono />
        <Fact label="Salesperson" value={order.salesperson || "Unassigned"} />
        <Fact label="Region" value={order.region || "Unmapped"} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
        <Pill tone="sky" label={`${scheduled}/${items.length} scheduled`} />
        <Pill tone="emerald" label={`${dispatched}/${items.length} dispatched`} />
        {blocked > 0 && <Pill tone="amber" label={`${blocked} blocked`} />}
        {order.dueToday ? <Pill tone="indigo" label={`${order.dueToday} out today`} /> : null}
        <Pill tone="zinc" label={committed ? `committed ${dayLabel(committed)}` : "no date yet"} />
        {order.soDelayReason && (
          <span className="truncate text-amber-600 dark:text-amber-400" title={order.soDelayReason}>
            {order.soDelayReason}
          </span>
        )}
      </div>
      {view === "dispatched" && order.proofDocs && (
        <ProofDocChips docs={order.proofDocs} />
      )}
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
      </div>
      {order.lifecycle === "cancelled" && (order as any).localCancelReason && (
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400" title="Floor cancellation reason">
          Cancelled: {(order as any).localCancelReason}
        </p>
      )}
    </div>
  );
}

/** Cards are memoised: a live-event refetch re-renders the list, and only
 *  cards whose order object actually changed should redo their item filters. */
export const MemoOrderCard = React.memo(OrderCard);

/** One labelled fact on a card: muted label above the value. */
function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{label}</div>
      <div
        className={`mt-0.5 truncate text-[11px] font-medium text-zinc-700 dark:text-zinc-200 ${mono ? "font-mono" : ""}`}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function Pill({ tone, label }: { tone: "sky" | "emerald" | "amber" | "indigo" | "zinc"; label: string }) {
  const tones = {
    sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    zinc: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  } as const;
  return <span className={`rounded-full px-2 py-0.5 font-semibold ${tones[tone]}`}>{label}</span>;
}

/** Dispatch-paperwork checklist chips (Dispatched tab only): which of the five
 *  optional proof documents are still pending on this order. `docs` is true =
 *  attached on at least one proof; absent rows hide the strip entirely. */
function ProofDocChips({ docs }: { docs: NonNullable<CrmOrder["proofDocs"]> }) {
  const slots = [
    { key: "before", label: "Before packing" },
    { key: "after", label: "After packing" },
    { key: "transport", label: "Transport receipt" },
    { key: "courier", label: "Courier receipt" },
    { key: "packingList", label: "Packing list" },
  ] as const;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-zinc-100 pt-2 text-[10px] dark:border-zinc-800">
      <span className="font-bold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Docs</span>
      {slots.map(({ key, label }) =>
        docs[key] ? (
          <span
            key={key}
            className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-600 dark:text-emerald-400"
          >
            {label}
          </span>
        ) : (
          <span
            key={key}
            className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-600 dark:text-amber-400"
            title={`${label} — pending. Open the order to attach it.`}
          >
            {label} · pending
          </span>
        ),
      )}
    </div>
  );
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
