// ── Auto dialer: pure rules (sync-only; safe in tests and both runtimes) ────
import {
  DEFAULT_CONFIG, NOT_DISPOSED,
  type BreakReason, type DialerConfig, type Disposition, type ScheduledBreak,
} from './types';

export class DialerError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const KEY_RE = /^[A-Z][A-Z0-9_]{1,39}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export function toKey(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

function cleanDispositions(raw: unknown): Disposition[] {
  if (!Array.isArray(raw)) return DEFAULT_CONFIG.dispositions;
  const seen = new Set<string>();
  const out: Disposition[] = [];
  for (const d of raw.slice(0, 30)) {
    const label = String(d?.label ?? '').trim().slice(0, 40);
    const key = toKey(d?.key || label);
    if (!label || !KEY_RE.test(key) || key === NOT_DISPOSED || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label, connected: !!d?.connected, retry: !!d?.retry, callback: !!d?.callback });
  }
  if (out.length === 0) throw new DialerError('at least one disposition is required');
  return out;
}

function cleanBreaks(raw: unknown): BreakReason[] {
  if (!Array.isArray(raw)) return DEFAULT_CONFIG.breakReasons;
  const seen = new Set<string>();
  const out: BreakReason[] = [];
  for (const b of raw.slice(0, 20)) {
    const label = String(b?.label ?? '').trim().slice(0, 40);
    const key = toKey(b?.key || label);
    if (!label || !KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label, maxMin: clampInt(b?.maxMin, 0, 240, 0), needsNote: !!b?.needsNote });
  }
  if (out.length === 0) throw new DialerError('at least one break reason is required');
  return out;
}

function cleanScheduled(raw: unknown): ScheduledBreak[] {
  if (!Array.isArray(raw)) return [];
  const out: ScheduledBreak[] = [];
  for (const b of raw.slice(0, 30)) {
    const label = String(b?.label ?? '').trim().slice(0, 40) || 'Break';
    const start = String(b?.start ?? '').trim();
    const end = String(b?.end ?? '').trim();
    if (!HHMM_RE.test(start) || !HHMM_RE.test(end)) throw new DialerError(`scheduled break "${label}": times must be HH:MM`);
    if (start >= end) throw new DialerError(`scheduled break "${label}": end must be after start`);
    const agents = Array.isArray(b?.agents) ? [...new Set(b.agents.map((a: unknown) => String(a).trim().slice(0, 64)).filter(Boolean))] as string[] : [];
    const id = String(b?.id ?? '').trim().slice(0, 40) || `sb_${out.length}_${start.replace(':', '')}`;
    out.push({ id, label, start, end, agents: agents.slice(0, 200) });
  }
  return out;
}

/** The scheduled breaks one agent's phone must honour (others are stripped). */
export function scheduledFor(cfg: DialerConfig, telecallerId: string): ScheduledBreak[] {
  return cfg.scheduledBreaks.filter((b) => b.agents.length === 0 || b.agents.includes(telecallerId));
}

/** Validate a Controller write (throws DialerError on junk, never silent). */
export function normalizeConfig(raw: any, actor = ''): DialerConfig {
  const shiftStart = String(raw?.shiftStart ?? DEFAULT_CONFIG.shiftStart).trim();
  const shiftEnd = String(raw?.shiftEnd ?? DEFAULT_CONFIG.shiftEnd).trim();
  if (!HHMM_RE.test(shiftStart) || !HHMM_RE.test(shiftEnd)) throw new DialerError('shift times must be HH:MM');
  if (shiftStart >= shiftEnd) throw new DialerError('shift end must be after shift start');
  return {
    dispositionSec: clampInt(raw?.dispositionSec, 5, 120, DEFAULT_CONFIG.dispositionSec),
    nextCallSec: clampInt(raw?.nextCallSec, 0, 30, DEFAULT_CONFIG.nextCallSec),
    shiftStart,
    shiftEnd,
    retryGapMin: clampInt(raw?.retryGapMin, 5, 24 * 60, DEFAULT_CONFIG.retryGapMin),
    retryMax: clampInt(raw?.retryMax, 0, 10, DEFAULT_CONFIG.retryMax),
    dispositions: cleanDispositions(raw?.dispositions),
    breakReasons: cleanBreaks(raw?.breakReasons),
    scheduledBreaks: cleanScheduled(raw?.scheduledBreaks),
    trackPhoneCalls: raw?.trackPhoneCalls === undefined ? DEFAULT_CONFIG.trackPhoneCalls : !!raw.trackPhoneCalls,
    updatedAt: new Date().toISOString(),
    updatedBy: String(actor).slice(0, 120),
  };
}

/** Stored JSON → config; fail-open to defaults so a bad row never blocks phones. */
export function parseStoredConfig(value: unknown): DialerConfig {
  if (!value) return DEFAULT_CONFIG;
  try {
    const parsed = JSON.parse(String(value));
    const cfg = normalizeConfig(parsed, String(parsed?.updatedBy ?? ''));
    return { ...cfg, updatedAt: String(parsed?.updatedAt ?? '') };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function dispositionOf(cfg: DialerConfig, key: string): Disposition | null {
  return cfg.dispositions.find((d) => d.key === key) ?? null;
}

/**
 * What happens to a queue row after its call is disposed.
 * - callback disposition with a time → back in the queue at that time
 * - retry disposition under the attempt cap → back after retryGapMin
 * - retry disposition at the cap → unreachable (never re-queued)
 * - anything else → done
 */
export function queueOutcome(
  cfg: DialerConfig,
  dispositionKey: string,
  attempts: number,
  callbackAt: string | null,
  now = Date.now(),
): { status: 'pending' | 'done' | 'unreachable'; source: string; dueAt: string | null } {
  const d = dispositionOf(cfg, dispositionKey);
  if (d?.callback && callbackAt && Number.isFinite(Date.parse(callbackAt))) {
    return { status: 'pending', source: 'callback', dueAt: new Date(Date.parse(callbackAt)).toISOString() };
  }
  if (d?.retry && attempts < cfg.retryMax) {
    return { status: 'pending', source: 'retry', dueAt: new Date(now + cfg.retryGapMin * 60_000).toISOString() };
  }
  if (d?.retry) return { status: 'unreachable', source: '', dueAt: null };
  return { status: 'done', source: '', dueAt: null };
}

/** IST hour (0-23) of an ISO timestamp — the report's hourly bucket. */
export function istHour(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 0;
  return new Date(ms + 5.5 * 3600_000).getUTCHours();
}

/** Seconds a break ran past its reason's limit (0 when unlimited or within). */
export function breakOverrunSec(cfg: DialerConfig, reasonKey: string, durationSec: number): number {
  const reason = cfg.breakReasons.find((r) => r.key === reasonKey);
  if (!reason || reason.maxMin <= 0) return 0;
  return Math.max(0, durationSec - reason.maxMin * 60);
}
