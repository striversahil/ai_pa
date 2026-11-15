// hr/position-dashboards.ts — position → dashboard registry (phase 1: root-only builder).
//
// Code-config drafts (founder decision): layouts stay in git until approved,
// no D1/KV migration for phase 1. Adding a position = one entry here, zero
// router/component forks.
//
// Pure module: no fetch, no React, no I/O. Guard:
// scripts/guards/position-workspace.test.mjs.
import { ORG_POSITIONS, isOrgTitle } from "./organization";

/** Widget keys the single position renderer understands. */
export type PositionWidgetKey =
  | "tasks"
  | "severity"
  | "target"
  | "visits"
  | "team"
  | "presence";

export const POSITION_WIDGETS: readonly PositionWidgetKey[] = [
  "tasks", "severity", "target", "visits", "team", "presence",
];

export interface PositionDashboardDef {
  title: string;
  department: string;
  /** Widget order for the phase-1 preview. */
  widgets: PositionWidgetKey[];
  description: string;
}

/**
 * Phase-1 packs (answers: Sales Head + Telecaller first).
 * Other chart titles resolve via fallback below — builder lists them as
 * "deferred", never crashes.
 */
const PHASE_ONE: Record<string, PositionDashboardDef> = {
  "Sales Head": {
    title: "Sales Head",
    department: "Sales",
    widgets: ["severity", "target", "team", "tasks", "presence"],
    description: "Targets + team health + escalations. Daily: mill-visit check, target shortfall review.",
  },
  Telecaller: {
    title: "Telecaller",
    department: "Sales",
    widgets: ["tasks", "severity", "target", "presence"],
    description: "Follow-ups + own severity. Daily: estimate follow-ups, visit updates.",
  },
};

export function positionDashboard(title: string): PositionDashboardDef | null {
  const t = String(title ?? "").trim();
  if (!t || !isOrgTitle(t)) return null;
  const direct = PHASE_ONE[t];
  if (direct) return direct;
  const pos = ORG_POSITIONS.find((p) => p.title === t);
  if (!pos) return null;
  // Deferred positions: sensible default pack so the builder never holes.
  return {
    title: t,
    department: pos.department,
    widgets: ["tasks", "severity", "presence"],
    description: `Deferred pack — default widgets until the pack is designed.`,
  };
}

export function isPhaseOneTitle(title: string): boolean {
  return Object.prototype.hasOwnProperty.call(PHASE_ONE, String(title ?? "").trim());
}

// ── Severity (gamified display over escalation state) ──

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export const SEVERITY_META: Record<Severity, { label: string; dot: string; chip: string }> = {
  critical: { label: "🔴 Critical", dot: "bg-rose-500", chip: "bg-rose-500/15 text-rose-500" },
  high: { label: "🟠 High", dot: "bg-orange-500", chip: "bg-orange-500/15 text-orange-500" },
  medium: { label: "🟡 Medium", dot: "bg-amber-500", chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  low: { label: "🔵 Low", dot: "bg-sky-500", chip: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  info: { label: "⚪ Info", dot: "bg-zinc-400", chip: "bg-zinc-500/15 text-zinc-500" },
};

/**
 * Escalation state → severity (pure, mirrored anywhere it renders).
 * L3 → critical, L2 → high, overdue → high, due < 24h → medium,
 * priority HIGH → medium, else low/info.
 */
export function severityFor(opts: {
  escalationLevel?: number | null;
  dueAt?: string | null;
  priority?: string | null;
  nowMs?: number;
}): Severity {
  const level = Number(opts.escalationLevel ?? 0);
  if (level >= 3) return "critical";
  if (level === 2) return "high";
  const dueMs = opts.dueAt ? Date.parse(opts.dueAt) : NaN;
  const now = opts.nowMs ?? Date.now();
  if (!Number.isNaN(dueMs)) {
    if (dueMs < now) return "high";
    if (dueMs - now < 24 * 3600 * 1000) return "medium";
  }
  if (level === 1) return "medium";
  if (String(opts.priority ?? "").toUpperCase() === "HIGH") return "medium";
  if (String(opts.priority ?? "").toUpperCase() === "URGENT") return "high";
  return opts.dueAt ? "low" : "info";
}

/** Flashing states (phase-1 gamification): critical + overdue high pulse. */
export function shouldFlash(severity: Severity, dueAt?: string | null, nowMs?: number): boolean {
  if (severity === "critical") return true;
  if (severity !== "high") return false;
  const dueMs = dueAt ? Date.parse(dueAt) : NaN;
  if (Number.isNaN(dueMs)) return false;
  return dueMs < (nowMs ?? Date.now());
}

// ── Hierarchy preview (who may preview whom) ──

const REPORTS_TO = new Map(ORG_POSITIONS.map((p) => [p.title, p.reportsTo]));

/** All titles below `title` in the reports_to chain (transitive). */
export function descendantsOf(title: string): string[] {
  const t = String(title ?? "").trim();
  const children = ORG_POSITIONS.filter((p) => p.reportsTo === t).map((p) => p.title);
  const out: string[] = [...children];
  for (const c of children) out.push(...descendantsOf(c));
  return [...new Set(out)];
}

/**
 * May `viewerTitle` preview `targetTitle`? Root/admin bypass separately
 * (server + canView); this is the chart rule: self + any descendant.
 */
export function canPreviewByTitles(viewerTitle: string | null, targetTitle: string): boolean {
  const v = String(viewerTitle ?? "").trim();
  const t = String(targetTitle ?? "").trim();
  if (!v || !t) return false;
  if (v === t) return true;
  return descendantsOf(v).includes(t);
}
