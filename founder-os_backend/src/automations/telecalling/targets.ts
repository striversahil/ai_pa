// targets.ts — region sales targets + weekly carry-forward (PURE, no I/O).
//
// Founder rule (2026-10-26): EVERY region team owes ₹1,00,000 of ACCEPTED
// estimate value per working day (Mon–Sat, 6-day week) — ₹6L for a full week
// — regardless of headcount. A region that misses its week carries the
// shortfall into the next week: dues grow, they are never forgiven. A surplus
// clears backlog first and is NOT banked (a good week buys you out of debt,
// it does not pre-pay the future).
//
//   carry(0)  = 0
//   due(w)    = carry(w-1) + dailyTarget × workingDaysElapsed(w)
//   carry(w)  = max(0, due(w) − accepted(w))
//
// The current week's target accrues DAY BY DAY (workingDaysElapsed), so on a
// Monday a team is measured against one day, not six — nobody looks
// catastrophically behind at 09:00 Monday.
//
// Weeks are Monday-anchored IST day strings (YYYY-MM-DD). Everything here is
// date-string math so it runs identically on the Worker and in Node — no
// Date-with-timezone surprises, no clock reads (the caller passes asOfDay).
//
// The dashboard ledger is computed server-side and rendered as-is; the
// frontend keeps only the shared constant + label helpers
// (founder-os_frontend/src/telecalling/targets.ts).

/** ₹ per region per working day (founder-set). */
export const DAILY_REGION_TARGET = 100_000;
/** Working days per week (Mon–Sat; Sunday is the only off-day). */
export const WORKING_DAYS_PER_WEEK = 6;
/** Setting key holding the ledger start day (YYYY-MM-DD). */
export const TARGET_START_KEY = 'salesboard:targetStart';
/** Ledger start when the Setting is absent (founder decision: retroactive). */
export const DEFAULT_TARGET_START = '2026-10-01';

export type TargetStatus = 'cleared' | 'ontrack' | 'behind' | 'critical';

const DAY_MS = 86_400_000;

function dayMs(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? '').trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
}

function fmt(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Monday (IST day string) of the week containing `day`. '' when invalid. */
export function weekStartOf(day: string): string {
  const t = dayMs(day);
  if (t === null) return '';
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  return fmt(t - ((dow + 6) % 7) * DAY_MS);
}

/** Monday+5 — the Saturday a week closes on. '' when invalid. */
export function weekEndOf(day: string): string {
  const t = dayMs(day);
  if (t === null) return '';
  const dow = new Date(t).getUTCDay();
  return fmt(t - ((dow + 6) % 7) * DAY_MS + 5 * DAY_MS);
}

/** Working days (Mon–Sat) inclusive between two day strings. 0 when reversed. */
export function workingDaysBetween(from: string, to: string): number {
  const a = dayMs(from);
  const b = dayMs(to);
  if (a === null || b === null || b < a) return 0;
  let days = 0;
  for (let t = a; t <= b; t += DAY_MS) {
    if (new Date(t).getUTCDay() !== 0) days += 1;
  }
  return days;
}

/** One week of a region's ledger. */
export interface WeekLedgerRow {
  /** Monday of the week (may precede the ledger start for a partial week). */
  weekStart: string;
  /** Saturday the week closes on. */
  weekEnd: string;
  /** Working days counted so far in this week (never beyond asOfDay). */
  days: number;
  /** dailyTarget × days. */
  target: number;
  /** Accepted value booked in this week. */
  accepted: number;
  /** Backlog carried in from previous weeks. */
  carryIn: number;
  /** carryIn + target — everything this week had to deliver. */
  due: number;
  /** Under-delivery carried OUT to next week (0 when the week cleared). */
  gap: number;
  /** accepted − due when positive (clears backlog, never banked). */
  surplus: number;
  /** True when accepted ≥ due (backlog fully cleared). */
  cleared: boolean;
  /** accepted ÷ due (%), includes the carried backlog. */
  pct: number;
}

/** A region's full target position. */
export interface RegionTarget {
  region: string;
  perDay: number;
  /** Every week from the ledger start to the current week, oldest first. */
  weeks: WeekLedgerRow[];
  /** The current (partial) week — the one the dashboard leads with. */
  current: WeekLedgerRow;
  /** Current-week target (elapsed working days × dailyTarget). */
  weekTarget: number;
  weekAccepted: number;
  /** Current-week due including carry-in. */
  weekDue: number;
  /** weekAccepted ÷ weekDue (%). */
  weekPct: number;
  /** weekAccepted ÷ weekTarget (%) — pace against THIS week's own target. */
  pacePct: number;
  carryIn: number;
  carryOut: number;
  /** Since the ledger start. */
  sinceStart: { target: number; accepted: number; pct: number };
  /** Ranking metric: accepted ÷ target since the ledger start (%). */
  attainmentPct: number;
  status: TargetStatus;
}

function statusOf(carryOut: number, pacePct: number): TargetStatus {
  if (carryOut <= 0) return 'cleared';
  if (pacePct >= 100) return 'ontrack';
  if (pacePct >= 60) return 'behind';
  return 'critical';
}

/**
 * Build the per-region carry ledger.
 *
 * `acceptedByWeek` is keyed weekStart → region → accepted ₹ (the caller
 * groups accepted estimates by their `acceptedAt` day's week). Regions with no
 * rows simply show 0 accepted — the target still accrues.
 */
export function buildRegionTargets(opts: {
  regions: readonly string[];
  startDay: string;
  asOfDay: string;
  dailyTarget?: number;
  acceptedByWeek: Map<string, Map<string, number>>;
}): Map<string, RegionTarget> {
  const daily = opts.dailyTarget ?? DAILY_REGION_TARGET;
  const out = new Map<string, RegionTarget>();
  const startMs = dayMs(opts.startDay);
  const asOfMs = dayMs(opts.asOfDay);
  if (startMs === null || asOfMs === null || asOfMs < startMs) return out;

  // Every Monday from the week containing the start day to the current week.
  const firstWeek = weekStartOf(opts.startDay);
  const lastWeek = weekStartOf(opts.asOfDay);
  if (!firstWeek || !lastWeek) return out;
  const weekStarts: string[] = [];
  for (let t = dayMs(firstWeek)!; t <= dayMs(lastWeek)!; t += 7 * DAY_MS) {
    weekStarts.push(fmt(t));
  }

  for (const region of opts.regions) {
    const weeks: WeekLedgerRow[] = [];
    let carry = 0;
    for (const weekStart of weekStarts) {
      const wsMs = dayMs(weekStart)!;
      const weekEnd = fmt(wsMs + 5 * DAY_MS);
      // Elapsed working days: never before the ledger start, never past today,
      // never past Saturday.
      const fromMs = Math.max(wsMs, startMs);
      const toMs = Math.min(wsMs + 5 * DAY_MS, asOfMs);
      let days = 0;
      if (toMs >= fromMs) {
        for (let t = fromMs; t <= toMs; t += DAY_MS) {
          if (new Date(t).getUTCDay() !== 0) days += 1;
        }
      }
      const target = daily * days;
      const accepted = Math.round(opts.acceptedByWeek.get(weekStart)?.get(region) ?? 0);
      const due = carry + target;
      const gap = Math.max(0, due - accepted);
      weeks.push({
        weekStart,
        weekEnd,
        days,
        target,
        accepted,
        carryIn: carry,
        due,
        gap,
        surplus: Math.max(0, accepted - due),
        cleared: gap <= 0,
        pct: due > 0 ? Math.round((accepted / due) * 100) : accepted > 0 ? 100 : 0,
      });
      carry = gap;
    }

    const current = weeks[weeks.length - 1];
    if (!current) continue;
    const totalTarget = weeks.reduce((s, w) => s + w.target, 0);
    const totalAccepted = weeks.reduce((s, w) => s + w.accepted, 0);
    const pacePct = current.target > 0 ? Math.round((current.accepted / current.target) * 100) : 0;
    out.set(region, {
      region,
      perDay: daily,
      weeks,
      current,
      weekTarget: current.target,
      weekAccepted: current.accepted,
      weekDue: current.due,
      weekPct: current.pct,
      pacePct,
      carryIn: current.carryIn,
      carryOut: current.gap,
      sinceStart: {
        target: totalTarget,
        accepted: totalAccepted,
        pct: totalTarget > 0 ? Math.round((totalAccepted / totalTarget) * 100) : 0,
      },
      attainmentPct: totalTarget > 0 ? Math.round((totalAccepted / totalTarget) * 100) : 0,
      status: statusOf(current.gap, pacePct),
    });
  }
  return out;
}
