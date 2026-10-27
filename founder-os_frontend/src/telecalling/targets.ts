// targets.ts — region sales-target constants + display helpers (PURE).
//
// Mirror: founder-os_backend/src/automations/telecalling/targets.ts — change
// both together, same names + semantics. The LEDGER ITSELF is computed
// server-side (`regions[].target`, `meta.teamTarget`) and rendered as-is; this
// file must never re-derive a rupee figure, or the browser and the worker will
// drift. Only constants, labels and formatting live here.

/** ₹ each region team owes per working day (founder-set). */
export const DAILY_REGION_TARGET = 100_000;
/** Working days per week (Mon–Sat; Sunday is the only off-day). */
export const WORKING_DAYS_PER_WEEK = 6;

export type TargetStatus = "cleared" | "ontrack" | "behind" | "critical";

/** One week of a region's carry ledger (server-computed). */
export interface WeekLedgerRow {
  weekStart: string;
  weekEnd: string;
  days: number;
  target: number;
  accepted: number;
  carryIn: number;
  due: number;
  gap: number;
  surplus: number;
  cleared: boolean;
  pct: number;
}

/** A region's full target position (server-computed). */
export interface RegionTarget {
  region: string;
  perDay: number;
  weeks: WeekLedgerRow[];
  current: WeekLedgerRow;
  weekTarget: number;
  weekAccepted: number;
  weekDue: number;
  weekPct: number;
  pacePct: number;
  carryIn: number;
  carryOut: number;
  sinceStart: { target: number; accepted: number; pct: number };
  attainmentPct: number;
  status: TargetStatus;
}

/** Team roll-up of the four region ledgers (server-computed). */
export interface TeamTarget {
  perRegionPerDay: number;
  regions: number;
  teamPerDay: number;
  targetStart: string;
  asOfDay: string;
  weekFrom: string | null;
  weekTo: string | null;
  weekTarget: number;
  weekAccepted: number;
  carryIn: number;
  due: number;
  sinceStartTarget: number;
  sinceStartAccepted: number;
  pct: number;
  status: TargetStatus;
}

export const TARGET_STATUS_LABEL: Record<TargetStatus, string> = {
  cleared: "Cleared",
  ontrack: "On track",
  behind: "Behind",
  critical: "Critical",
};

/** Tailwind text colour per target status (dark-friendly). */
export const TARGET_STATUS_TEXT: Record<TargetStatus, string> = {
  cleared: "text-emerald-400",
  ontrack: "text-emerald-400",
  behind: "text-amber-400",
  critical: "text-rose-400",
};

/** Tailwind background per target status (progress fill). */
export const TARGET_STATUS_BG: Record<TargetStatus, string> = {
  cleared: "bg-emerald-500",
  ontrack: "bg-emerald-500",
  behind: "bg-amber-500",
  critical: "bg-rose-500",
};

/** Tailwind chip classes per target status. */
export const TARGET_STATUS_CHIP: Record<TargetStatus, string> = {
  cleared: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400",
  ontrack: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400",
  behind: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  critical: "border-rose-500/30 bg-rose-500/10 text-rose-500 dark:text-rose-400",
};

/** Clamp a server percentage into a CSS-safe bar width (min = visible sliver). */
export function barWidth(pct: number, min = 3): number {
  if (!Number.isFinite(pct)) return min;
  return Math.min(100, Math.max(min, Math.round(pct)));
}
