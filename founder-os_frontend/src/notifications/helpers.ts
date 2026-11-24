// ─────────────────────────────────────────────────────────────────────────────
// notifications/helpers.ts — labels + formatting for the bell and the console.
// Pure, no React, no fetch.
// ─────────────────────────────────────────────────────────────────────────────
import type { NotificationAudience, NotificationCadence, NotificationRule } from "./types";
import { relAgo, fmtIstDateTime, fmtIstTime } from "@/lib/format";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Clock/date formatting lives in `@/lib/format` (canonical) — re-exported here
 *  so the notification surfaces read naturally. */
export { fmtIstDateTime as istDateTime, fmtIstTime as istClock, relAgo as relTime };

export function minuteToClock(atMinute: number | undefined): string {
  const m = Math.max(0, Math.min(1439, Math.round(Number(atMinute ?? 570))));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function clockToMinute(value: string): number {
  const [h, m] = String(value ?? "").split(":").map((x) => Number(x));
  if (!Number.isFinite(h)) return 570;
  return Math.max(0, Math.min(1439, Math.round(h) * 60 + Math.round(Number.isFinite(m) ? m : 0)));
}

export function cadenceLabel(c: NotificationCadence | null | undefined): string {
  if (!c) return "—";
  switch (c.kind) {
    case "hourly":
      return "Every hour (IST)";
    case "everyNMin":
      return `Every ${Math.max(5, Number(c.n) || 60)} min`;
    case "daily":
      return `Daily ${minuteToClock(c.atMinute)} IST`;
    case "weekly": {
      const days = (c.days ?? []).map((d) => WEEKDAYS[d] ?? "").filter(Boolean).join(", ");
      return `${days || "Weekly"} ${minuteToClock(c.atMinute)} IST`;
    }
    default:
      return "Manual (Run now)";
  }
}

export function audienceLabel(audience: NotificationAudience | null | undefined): string {
  const a = audience ?? {};
  const parts: string[] = [];
  if ((a.positions ?? []).length) parts.push((a.positions ?? []).join(", "));
  if ((a.departments ?? []).length) parts.push((a.departments ?? []).join(", "));
  if ((a.regions ?? []).length) parts.push((a.regions ?? []).join(", "));
  if ((a.rosterTypes ?? []).length) parts.push((a.rosterTypes ?? []).join(", "));
  if ((a.roles ?? []).length) parts.push((a.roles ?? []).join(", "));
  if ((a.employees ?? []).length) parts.push(`${(a.employees ?? []).length} person(s)`);
  return parts.join(" · ") || "everyone";
}

export function ruleStatusLabel(rule: NotificationRule): { text: string; tone: "neutral" | "success" | "warning" | "danger" } {
  if (!rule.enabled) return { text: "Paused", tone: "neutral" };
  if (!rule.lastStatus) return { text: "Never run", tone: "neutral" };
  try {
    const s = JSON.parse(rule.lastStatus);
    if (s?.error) return { text: "Error", tone: "danger" };
    const dispatched = Number(s?.dispatched ?? 0);
    return { text: dispatched > 0 ? `${dispatched} sent` : "No action", tone: dispatched > 0 ? "success" : "neutral" };
  } catch {
    return { text: "Ran", tone: "neutral" };
  }
}

// ── Rules list: position + status filtering (console collapsed view) ──────────

const NO_POSITION = "(all positions)";

/** The position a rule speaks to (its first audience position), for grouping. */
export function rulePosition(rule: NotificationRule): string {
  const p = (rule.audience?.positions ?? []).map((x) => String(x ?? "").trim()).filter(Boolean);
  return p[0] ?? NO_POSITION;
}

export interface RulePositionSummary {
  position: string;
  live: number;
  paused: number;
  total: number;
}

/** One row per position with its live/paused counts — the at-a-glance header of
 *  the rules list, so every position's state is visible while collapsed. */
export function rulePositions(rules: NotificationRule[]): RulePositionSummary[] {
  const by = new Map<string, RulePositionSummary>();
  for (const r of rules ?? []) {
    const position = rulePosition(r);
    const row = by.get(position) ?? { position, live: 0, paused: 0, total: 0 };
    row.total++;
    if (r.enabled) row.live++;
    else row.paused++;
    by.set(position, row);
  }
  return [...by.values()].sort((a, b) => a.position.localeCompare(b.position));
}

/** `{hourly_connected_call}` — uppercase, non-word chars to underscores.
 *  mirror: founder-os_backend/src/modules/notifications/columns.ts#columnToken
 *  (guarded in scripts/guards/notifications.test.mjs). */
export function columnToken(column: string): string {
  return String(column ?? "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

export interface RuleFilter {
  q?: string;
  position?: string;
  status?: "all" | "live" | "paused";
}

/** Collapsed-view filter: free text over name/key/description, one position
 *  ("" = all), and live/paused. Pure — guarded by the notifications test. */
export function filterRules(rules: NotificationRule[], f: RuleFilter | null | undefined): NotificationRule[] {
  const q = String(f?.q ?? "").trim().toLowerCase();
  const position = String(f?.position ?? "").trim();
  const status = f?.status ?? "all";
  return (rules ?? []).filter((r) => {
    if (position && rulePosition(r) !== position) return false;
    if (status === "live" && !r.enabled) return false;
    if (status === "paused" && r.enabled) return false;
    if (!q) return true;
    return `${r.name} ${r.key} ${r.description ?? ""} ${audienceLabel(r.audience)}`.toLowerCase().includes(q);
  });
}

/** Empty rule scaffold for the drawer's "New rule". */
export function emptyRule(): NotificationRule {
  return {
    key: "",
    name: "",
    description: "",
    enabled: true,
    audience: { positions: [] },
    sqlText: "",
    titleTpl: "",
    bodyTpl: "",
    cadence: { kind: "hourly" },
    thresholds: [],
    escalation: {},
    nextDueAt: null,
    lastRunAt: null,
    lastStatus: null,
  };
}
