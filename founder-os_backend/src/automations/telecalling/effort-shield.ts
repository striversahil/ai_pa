/**
 * effort-shield.ts — pure shield evaluation over effort snapshots.
 *
 * Shield rule (founder-confirmed, 2026-09-08):
 *   If the AI flags an estimate unsatisfactory (red), ONLY the effort shield
 *   can keep it with the agent — otherwise the engine re-poaches it. Whether
 *   any call connected is IRRELEVANT: 3+ spread-out dials prove the agent
 *   worked the lead, even if every call went unanswered or the conversation
 *   still drew a bad remark.
 *
 *   - TODAY (IST): holder dialled this lead ≥ EFFORT_MIN_ATTEMPTS outgoing
 *     calls with first→last span ≥ EFFORT_MIN_SPAN_H  →  shield holds for
 *     today (no snatch, no −15).
 *   - STREAK: consecutive immediately-preceding days meeting the same bar
 *     (same holder) are counted back.
 *   - EXPIRY: streak ≥ EFFORT_MAX_SHIELD_DAYS (2) → shield over → the estimate
 *     is snatched and −15 applies, even if attempts continue.
 *
 * Counting is per-day from snapshots — yesterday's dials never count toward
 * today (daily zeroing). Estimates without a mappable phone get no shield.
 * `conn` is recorded as evidence only; it never affects the verdict.
 */
import type { EffortRow } from './effort-sync';

export const EFFORT_MIN_ATTEMPTS = 3;
export const EFFORT_MIN_SPAN_H = 2;
/** Consecutive effort days granted; the NEXT day snatches. */
export const EFFORT_MAX_SHIELD_DAYS = 2;

export type ShieldStatus = 'shielded-1' | 'shielded-2' | 'expiring' | 'insufficient' | 'no-phone';

export interface ShieldVerdict {
  shielded: boolean;
  /** Consecutive qualifying days before today (0, 1, or 2+). */
  streak: number;
  /** True when the holder earned it today but the 2-day grace is exhausted. */
  expired: boolean;
  status: ShieldStatus;
  reason: string;
  evidence: { n: number; spanH: number; conn: number } | null;
}

function dayAgg(rows: EffortRow[] | null, phone10: string, holderNeoId: string): EffortRow | null {
  if (!rows) return null;
  return rows.find((r) => r.p === phone10 && r.u === holderNeoId) ?? null;
}

function qualifies(a: EffortRow | null): boolean {
  // Deliberately conn-agnostic: connected or not, 3+ spread dials = effort.
  return !!a && a.n >= EFFORT_MIN_ATTEMPTS && a.spanH >= EFFORT_MIN_SPAN_H;
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
    return { shielded: false, streak: 0, expired: false, status: 'no-phone', reason: 'no phone/agent mapping — no shield', evidence: null };
  }
  const [today, yday, dbefore] = snaps;
  const a = dayAgg(today, phone10, holderNeoId);
  const evidence = a ? { n: a.n, spanH: a.spanH, conn: a.conn } : null;
  if (!qualifies(a)) {
    return {
      shielded: false, streak: 0, expired: false, status: 'insufficient',
      reason: `only ${a?.n ?? 0} attempts / ${a?.spanH ?? 0}h span today — needs 3+ calls over 2h+`,
      evidence,
    };
  }
  // Walk back consecutive qualifying days (cap: we only need 2).
  let streak = 0;
  for (const dayRows of [yday, dbefore]) {
    if (qualifies(dayAgg(dayRows, phone10, holderNeoId))) streak++;
    else break; // gap day (or no evidence) ends the walk
  }
  if (streak >= EFFORT_MAX_SHIELD_DAYS) {
    return {
      shielded: false, streak, expired: true, status: 'expiring',
      reason: `2-day effort grace exhausted (day 3) — snatches with −15 despite ${a!.n} attempts over ${a!.spanH}h`,
      evidence,
    };
  }
  return {
    shielded: true, streak, expired: false,
    status: streak >= 1 ? 'shielded-2' : 'shielded-1',
    reason: `effort shield day ${streak + 1}/2 — ${a!.n} calls over ${a!.spanH}h protect this estimate today`,
    evidence,
  };
}
