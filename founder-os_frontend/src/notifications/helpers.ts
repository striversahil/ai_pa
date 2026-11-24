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

/** `06:48–07:48 IST · 24 Nov` — the window a run actually evaluated. Critical
 *  context when a rule reports 0 rows: "no data" and "wrong window" look the
 *  same without it. */
export function windowLabel(startIso: string | null | undefined, endIso: string | null | undefined): string {
  if (!startIso || !endIso) return "—";
  try {
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "—";
    const day = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" }).format(start);
    return `${fmtIstTime(start.toISOString())}–${fmtIstTime(end.toISOString())} IST · ${day}`;
  } catch {
    return `${startIso} → ${endIso}`;
  }
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

// ── Message preview: the SQL's own output, or `null` ─────────────────────────
//
// Founder decision (2026-11-24): the preview must show what the query actually
// returned. Pick the row (default: the first), every token resolves from THAT
// row, and a token the SQL did not return renders the literal `null` — so a
// wrong/typo'd token is visible instead of silently blank.
//
// NOT a mirror of template.renderTemplate: dispatch keeps collapsing unknown
// tokens to "" (a `null` in a real notification would be noise). This renderer
// is presentation-only.

export interface PreviewWindow {
  windowStart?: string | null;
  windowEnd?: string | null;
  ruleName?: string;
  agentName?: string;
  /** identity value (telecaller_id / employee_key) → real recipient name, from
   *  the dry run. Lets {EMPLOYEE_NAME} resolve for the previewed ROW, not only
   *  for whoever happened to be notified first. */
  names?: Record<string, string>;
}

/** Row values (uppercased keys) + only the engine values that are REAL for this
 *  run. Nothing is invented: no placeholder names, no fake counts. */
export function previewFields(
  row: Record<string, unknown> | null | undefined,
  win: PreviewWindow | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row ?? {})) {
    if (v === null || v === undefined) continue;
    out[String(k).trim().toUpperCase()] = String(v);
  }
  const push = (key: string, value: unknown) => {
    if (key in out) return; // the SQL's own column always wins over an engine default
    if (value === null || value === undefined || value === "") return;
    out[key] = String(value);
  };
  // EMPLOYEE_NAME / AGENT_NAME are DEFAULT fields: the metric SQL returns ids,
  // not names, so the engine resolves the name from the HR register. Here it is
  // resolved for the previewed row (identity → name map from the same dry run).
  const identity = String(
    (row as any)?.telecaller_id ?? (row as any)?.employee_key ?? (row as any)?.employeeKey ?? (row as any)?.telecallerId ?? "",
  ).trim();
  const person = (identity && win?.names?.[identity]) || win?.agentName || null;
  push("WINDOW", win?.windowStart && win?.windowEnd ? `${fmtIstTime(win.windowStart)}–${fmtIstTime(win.windowEnd)} IST` : null);
  push("WINDOW_START", win?.windowStart);
  push("WINDOW_END", win?.windowEnd);
  push("DATE", win?.windowStart ? new Date(win.windowStart).toISOString().slice(0, 10) : null);
  push("RULE_NAME", win?.ruleName);
  push("RULE", win?.ruleName);
  push("EMPLOYEE_NAME", person);
  push("AGENT_NAME", person);
  return out;
}

/** Render a template against one result row. Unknown tokens → `null`. */
export function renderPreview(
  tpl: string,
  row: Record<string, unknown> | null | undefined,
  win: PreviewWindow | null | undefined,
): string {
  const fields = previewFields(row, win);
  return String(tpl ?? "").replace(/\{([A-Za-z0-9_]+)\}/g, (_m, raw: string) => fields[String(raw).toUpperCase()] ?? "null");
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
