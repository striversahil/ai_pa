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
