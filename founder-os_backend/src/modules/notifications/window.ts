// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/window.ts — cadence → evaluation window (PURE).
//
// A rule's window is the metric period, and it is ALIGNED so the same window
// is never evaluated twice and a restarted worker cannot re-send:
//   hourly      → the previous full IST hour          (?1/?2 = 13:00–14:00 IST)
//   everyNMin   → the previous N-minute block
//   daily       → the previous 24 h ending at HH:MM IST
//   weekly      → the previous 7 days ending at HH:MM IST
//   manual      → rolling window ending at the run time (Run now)
//
// IST is UTC+05:30 (a half-hour offset) — every boundary is computed on IST
// wall-clock, never on the UTC minute, so "hourly" means the shop-floor hour.
// ─────────────────────────────────────────────────────────────────────────────
import type { NotificationCadence } from "./types";

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

export interface RunWindow {
  start: Date;
  end: Date;
  startIso: string;
  endIso: string;
  /** Dedupe key for the dispatch (rule key is added by the engine). */
  key: string;
}

function clampN(n: unknown, fallback = 60): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(1440, Math.max(5, v)) : fallback;
}

/** Minute-of-day (IST) for a cadence; defaults to 09:30 IST. */
function atMinuteOf(cadence: NotificationCadence): number {
  const v = Math.round(Number(cadence.atMinute));
  return Number.isFinite(v) ? Math.min(1439, Math.max(0, v)) : 9 * 60 + 30;
}

/** Window length in ms for a cadence. */
export function cadenceLengthMs(cadence: NotificationCadence): number {
  switch (cadence?.kind) {
    case "hourly":
      return HOUR_MS;
    case "everyNMin":
      return clampN(cadence.n) * MIN_MS;
    case "daily":
      return DAY_MS;
    case "weekly":
      return 7 * DAY_MS;
    default:
      return HOUR_MS;
  }
}

/** Floor a timestamp to the most recent IST hour boundary. */
export function istHourFloor(at: Date | number): Date {
  const ms = (at instanceof Date ? at.getTime() : Number(at)) + IST_OFFSET_MS;
  return new Date(Math.floor(ms / HOUR_MS) * HOUR_MS - IST_OFFSET_MS);
}

/** IST day key `YYYY-MM-DD` — the same format the dialer/stock modules use. */
export function istDayKey(at: Date | number): string {
  const d = new Date((at instanceof Date ? at.getTime() : Number(at)) + IST_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

/** Build the window a rule evaluates. `align` (default true) snaps the end to
 *  the cadence boundary; `align: false` is the "Run now"/Test rolling window. */
export function windowFor(cadence: NotificationCadence, slot: Date | number, opts?: { align?: boolean }): RunWindow {
  const align = opts?.align !== false;
  const nowMs = slot instanceof Date ? slot.getTime() : Number(slot);
  let endMs: number;
  if (!align) {
    endMs = nowMs;
  } else if (cadence?.kind === "hourly") {
    endMs = istHourFloor(nowMs).getTime();
  } else if (cadence?.kind === "everyNMin") {
    const n = clampN(cadence.n);
    endMs = Math.floor(nowMs / (n * MIN_MS)) * (n * MIN_MS);
  } else {
    // daily/weekly: the most recent HH:MM IST occurrence at or before now.
    const dayStartIst = Math.floor((nowMs + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
    let occ = dayStartIst + atMinuteOf(cadence) * MIN_MS;
    if (occ > nowMs) occ -= DAY_MS;
    if (cadence?.kind === "weekly") {
      const days = (cadence.days ?? []).map((d) => Math.round(Number(d))).filter((d) => d >= 0 && d <= 6);
      if (days.length > 0) {
        for (let i = 0; i < 8; i++) {
          const candidate = occ - i * DAY_MS;
          const weekday = new Date(candidate + IST_OFFSET_MS).getUTCDay();
          if (days.includes(weekday)) {
            occ = candidate;
            break;
          }
        }
      }
    }
    endMs = occ;
  }
  const startMs = endMs - cadenceLengthMs(cadence);
  return {
    start: new Date(startMs),
    end: new Date(endMs),
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    key: `${new Date(startMs).toISOString()}..${new Date(endMs).toISOString()}`,
  };
}

/**
 * Next time this rule is due (ms), from `from`. `manual` returns null (only the
 * console's Run now fires it). Always strictly after `from`.
 */
export function nextDueAt(cadence: NotificationCadence, from: Date | number): Date | null {
  const fromMs = from instanceof Date ? from.getTime() : Number(from);
  if (!cadence || cadence.kind === "manual") return null;
  if (cadence.kind === "hourly") {
    return new Date(istHourFloor(fromMs).getTime() + HOUR_MS);
  }
  if (cadence.kind === "everyNMin") {
    const n = clampN(cadence.n);
    const block = Math.floor(fromMs / (n * MIN_MS)) * (n * MIN_MS) + n * MIN_MS;
    return new Date(block);
  }
  const win = windowFor(cadence, fromMs, { align: true });
  const candidate = win.end.getTime() + DAY_MS;
  if (cadence.kind === "weekly") {
    const days = (cadence.days ?? []).map((d) => Math.round(Number(d))).filter((d) => d >= 0 && d <= 6);
    let next = candidate + DAY_MS;
    for (let i = 0; i <= 8; i++) {
      const at = win.end.getTime() + i * DAY_MS;
      if (at <= fromMs) continue;
      if (days.length === 0 || days.includes(new Date(at + IST_OFFSET_MS).getUTCDay())) {
        next = at;
        break;
      }
    }
    return new Date(next);
  }
  return new Date(candidate);
}
