// Extracted verbatim from service.ts by scripts/refactor/split-module.mjs.
// service.ts re-exports everything public here, so existing imports keep working.
import type { EstimateRisk } from "../risk";
import { istDate } from "../util";

// ── Accepted-value targets ─────────────────────────────────────────────────
// "Won ₹" = total ₹ of ACCEPTED estimates whose acceptance day (acceptedAt)
// falls in the selected period. Wins no longer come from the close-event
// ledger — see accepted.ts for why.
//
// Founder rule (2026-10-26): every REGION team owes ₹1,00,000 of accepted
// value per working day (Mon–Sat), and week-to-week shortfalls carry forward.
// The model lives in targets.ts (pure); there is no team-wide ₹5L/₹10L bar any
// more — the team bar is simply the sum of the four region targets.

/** Per-risk close-probability factor used for estimated-conversion projection. */
export function toCloseMultiplier(risk: EstimateRisk): number {
  switch (risk) {
    case 'ok': return 1.0;
    case 'pending': return 0.7;
    case 'red': return 0.35;
    case 'zombie': return 0.15;
    default: return 0.7;
  }
}

export const RISK_LIST_CAP = 25;

// ── Enquiry-sourced lead generation ──────────────────────────────────────────
// "Leads generated" = enquiries created per agent per IST day (Sales Enquiries
// dashboard: Enquiry.createdAt × assignedAgentId). The dialer still feeds calls,
// talk-time and call outcomes — only the leads-generated numerator is
// enquiry-sourced.

/** Day → agent lead counts for an inclusive IST range. Key `${day}|${agentId}`.
 *  Unattributed rows (assignedAgentId empty — no roster match) are counted
 *  under the UNATTRIBUTED_LEADS_KEY sentinel so they surface in meta instead
 *  of vanishing silently. Callers must skip the sentinel when attributing. */
export const UNATTRIBUTED_LEADS_KEY = '|unattributed';

/** Sentinel owner for accepted estimates with no creator (root daily export). */
export const UNATTRIBUTED_CLOSE_KEY = '|unlinked';

/** Shift a YYYY-MM-DD string by N days (UTC arithmetic on the date parts). */
export function shiftDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** IST date range for a leaderboard period. null = today (default view). */
export function periodRange(period: string, todayStr: string): { from: string; to: string; label: string } | null {  const [y, m, d] = todayStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  const backToMonday = (dow + 6) % 7;
  switch (period) {
    case 'week': {
      const monday = shiftDays(todayStr, -backToMonday);
      return { from: monday, to: todayStr, label: 'This Week' };
    }
    case 'lastweek': {
      const monday = shiftDays(todayStr, -backToMonday);
      return { from: shiftDays(monday, -7), to: shiftDays(monday, -1), label: 'Last Week' };
    }
    case 'month':
      return { from: todayStr.slice(0, 8) + '01', to: todayStr, label: 'This Month' };
    case 'lastmonth': {
      const prevLast = new Date(Date.UTC(y, m - 1, 0));
      return { from: prevLast.toISOString().slice(0, 8) + '01', to: prevLast.toISOString().slice(0, 10), label: 'Last Month' };
    }
    case 'year':
      return { from: `${y}-01-01`, to: todayStr, label: 'This Year' };
    case 'lastyear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: 'Last Year' };
    default:
      return null;
  }
}

/** Short prefix for the filter-period target line (wk ₹… / mo ₹… / …). */
export function periodPrefix(period: string): string {
  switch (period) {
    case 'week': return 'wk';
    case 'lastweek': return 'last wk';
    case 'month': return 'mo';
    case 'lastmonth': return 'last mo';
    case 'year': return 'yr';
    case 'lastyear': return 'last yr';
    case 'custom': return 'range';
    default: return 'today';
  }
}

// -- Filter windows: presets AND an arbitrary from->to range ---------------
// The leaderboard is already a pure from->to window; presets are only a
// name->dates resolver. A custom range is validated/clamped HERE so the board
// cache key and every downstream read see ONE normalized window (never a raw
// client string). Precedence: from/to > period. null = day mode (today/?date=).

/** Longest custom range honoured - matches listDays() below, which the
 *  Controller's daily export caps at 93 days. */
export const MAX_CUSTOM_RANGE_DAYS = 93;

export interface PeriodWindow {
  from: string;
  to: string;
  label: string;
  kind: 'preset' | 'custom';
  /** True when the requested span was longer than MAX_CUSTOM_RANGE_DAYS. */
  clamped?: boolean;
}

const ISO_DAY_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function dayMsOf(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

/** Resolve ?from/?to (custom) or ?period (preset) into one window.
 *  A custom range is swapped when reversed, never reaches into the future
 *  (that would inflate the working-day target) and is capped at
 *  MAX_CUSTOM_RANGE_DAYS. Anything else falls through to the presets. */
export function resolvePeriod(
  q: { period?: unknown; from?: unknown; to?: unknown },
  today: string,
): PeriodWindow | null {
  const f = typeof q.from === 'string' && ISO_DAY_RE.test(q.from) ? q.from : null;
  const t = typeof q.to === 'string' && ISO_DAY_RE.test(q.to) ? q.to : null;
  if (f && t) {
    let from = f;
    let to = t;
    if (from > to) [from, to] = [to, from];
    if (to > today) to = today;
    if (from > to) from = to;
    let clamped = false;
    const span = Math.round((dayMsOf(to) - dayMsOf(from)) / 86400000) + 1;
    if (span > MAX_CUSTOM_RANGE_DAYS) {
      from = shiftDays(to, -(MAX_CUSTOM_RANGE_DAYS - 1));
      clamped = true;
    }
    return { from, to, label: 'Custom range', kind: 'custom', clamped };
  }
  const preset = periodRange(typeof q.period === 'string' ? q.period : 'today', today);
  return preset ? { ...preset, kind: 'preset' } : null;
}

/** Working days (Mon–Sat, 6-day work week) inclusive between two IST dates. */
export function workingDaysBetween(from: string, to: string): number {  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  if (end < start) return 0;
  let days = 0;
  for (let t = start; t <= end; t += 86400000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0) days += 1; // exclude Sunday only (6-day work week)
  }
  return Math.max(1, days);
}

/** IST day (YYYY-MM-DD) of a stored Date/ISO value. null when unparseable. */
export function istDayOf(val: unknown): string | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(String(val));
  if (Number.isNaN(d.getTime())) return null;
  return istDate(d);
}

/** YYYY-MM-DD list inclusive. null when the range exceeds the cap. */
export function listDays(from: string, to: string, cap = 93): string[] | null {
  const out: string[] = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if ([fy, fm, fd, ty, tm, td].some((n) => !Number.isFinite(n))) return [];
  let t = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  if (end < t) return [];
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    if (out.length > cap) return null;
    t += 86400000;
  }
  return out;
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function weekdayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if ([y, m, d].some((n) => !Number.isFinite(n))) return '';
  return WEEKDAY_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
}
