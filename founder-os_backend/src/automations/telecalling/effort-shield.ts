/**
 * effort-shield.ts — pure shield evaluation over effort snapshots.
 *
 * Shield rule (founder-confirmed):
 *   - TODAY (IST): holder dialled this lead ≥ EFFORT_MIN_ATTEMPTS outgoing
 *     calls, first→last span ≥ EFFORT_MIN_SPAN_H, and NOBODY connected on
 *     this lead today  →  shield holds for today (no snatch, no −15).
 *   - STREAK: consecutive immediately-preceding days meeting the same bar
 *     (by the same holder, no connect on the lead) are counted back.
 *   - EXPIRY: streak ≥ EFFORT_MAX_SHIELD_DAYS (2) → shield over → the estimate
 *     is snatched and −15 applies, even if attempts continue.
 *   - Any connected call on the lead voids neglect for that day (streak reset).
 *
 * Counting is per-day from snapshots — yesterday's dials never count toward
 * today (daily zeroing). Estimates without a mappable phone get no shield.
 */
import type { EffortRow } from './effort-sync';

export const EFFORT_MIN_ATTEMPTS = 3;
export const EFFORT_MIN_SPAN_H = 2;
/** Consecutive no-connect effort days granted; the NEXT day snatches. */
export const EFFORT_MAX_SHIELD_DAYS = 2;

export interface ShieldVerdict {
  shielded: boolean;
  /** Consecutive qualifying no-connect days before today (0, 1, or 2+). */
  streak: number;
  /** True when the holder earned it today but the 2-day grace is exhausted. */
  expired: boolean;
  reason: string;
  evidence: { n: number; spanH: number; conn: number } | null;
}

function dayAgg(rows: EffortRow[] | null, phone10: string, holderNeoId: string): EffortRow | null {
  if (!rows) return null;
  return rows.find((r) => r.p === phone10 && r.u === holderNeoId) ?? null;
}

function dayConnected(rows: EffortRow[] | null, phone10: string): boolean {
  if (!rows) return false;
  return rows.some((r) => r.p === phone10 && r.conn === 1);
}

function qualifies(a: EffortRow | null, connected: boolean): boolean {
  return !!a && a.n >= EFFORT_MIN_ATTEMPTS && a.spanH >= EFFORT_MIN_SPAN_H && !connected;
}

/**
 * @param snaps snapshots for [today, yesterday, dayBefore] (null = no evidence).
 */
export function evaluateShield(
  phone10: string,
  holderNeoId: string,
  snaps: [EffortRow[] | null, EffortRow[] | null, EffortRow[] | null],
): ShieldVerdict {
  if (!phone10 || !holderNeoId) {
    return { shielded: false, streak: 0, expired: false, reason: 'no phone/agent mapping — no shield', evidence: null };
  }
  const [today, yday, dbefore] = snaps;
  const connToday = dayConnected(today, phone10);
  const a = dayAgg(today, phone10, holderNeoId);
  const evidence = a ? { n: a.n, spanH: a.spanH, conn: connToday ? 1 : 0 } : null;
  if (!qualifies(a, connToday)) {
    const why = connToday ? 'lead connected today — no neglect case' : `only ${a?.n ?? 0} attempts / ${a?.spanH ?? 0}h span today`;
    return { shielded: false, streak: 0, expired: false, reason: why, evidence };
  }
  // Walk back consecutive qualifying no-connect days (cap: we only need 2).
  let streak = 0;
  for (const dayRows of [yday, dbefore]) {
    if (dayConnected(dayRows, phone10)) break; // a connect resets the streak
    const prev = dayAgg(dayRows, phone10, holderNeoId);
    if (prev && prev.n >= EFFORT_MIN_ATTEMPTS && prev.spanH >= EFFORT_MIN_SPAN_H) streak++;
    else break; // gap day (or no evidence) ends the walk
  }
  if (streak >= EFFORT_MAX_SHIELD_DAYS) {
    return {
      shielded: false, streak, expired: true,
      reason: `2-day effort grace exhausted (streak ${streak}) — snatch + −15`,
      evidence,
    };
  }
  return {
    shielded: true, streak, expired: false,
    reason: `effort shield day ${streak + 1}/2 — ${a!.n} attempts over ${a!.spanH}h, 0 connected`,
    evidence,
  };
}
