// ── Pure parsing/validation for device call batches ─────────────────────────
import {
  MAX_BATCH,
  STATUSES,
  FINAL_STATUSES,
  DIRECTIONS,
  istDay,
  type ParsedCall,
} from './types';

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function e164(raw: unknown): string {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 11 && digits.startsWith('0')) return '91' + digits.slice(1);
  return digits;
}

function iso(raw: unknown, fallback?: number): string | null {
  if (typeof raw !== 'string' || !raw) return fallback ? new Date(fallback).toISOString() : null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return fallback ? new Date(fallback).toISOString() : null;
  const now = Date.now();
  // Clock skew: never accept a future attempt beyond 10 minutes.
  return new Date(Math.min(ms, now + 10 * 60_000)).toISOString();
}

function int(raw: unknown, max: number): number {
  const n = Math.floor(Number(raw ?? 0));
  return Number.isFinite(n) ? Math.max(0, Math.min(n, max)) : 0;
}

export interface ParseResult {
  calls: ParsedCall[];
  errors: string[];
}

export async function parseBatch(body: unknown, deviceId: string): Promise<ParseResult> {
  const list = (body as any)?.calls;
  const errors: string[] = [];
  if (!Array.isArray(list) || list.length === 0) return { calls: [], errors: ['calls[] required'] };
  if (list.length > MAX_BATCH) return { calls: [], errors: [`max ${MAX_BATCH} calls per batch`] };

  const calls: ParsedCall[] = [];
  for (let i = 0; i < list.length; i++) {
    const raw = list[i] ?? {};
    const id = String(raw.id ?? '').trim();
    if (!id) { errors.push(`#${i}: id required`); continue; }
    const attemptAt = iso(raw.attemptAt);
    if (!attemptAt) { errors.push(`#${i}: attemptAt invalid`); continue; }
    const age = Date.now() - Date.parse(attemptAt);
    if (age > 7 * 24 * 3600_000) { errors.push(`#${i}: older than 7 days`); continue; }

    const status = String(raw.status ?? '').toUpperCase();
    if (!STATUSES.has(status)) { errors.push(`#${i}: bad status`); continue; }
    const direction = String(raw.direction ?? 'UNKNOWN').toUpperCase();
    const number = e164(raw.number);
    const numberHash = number ? await sha256Hex(number) : '';
    const declaredDevice = String(raw.deviceId ?? '').trim();
    if (declaredDevice && declaredDevice !== deviceId) { errors.push(`#${i}: deviceId mismatch`); continue; }
    const idempotencyKey = `${deviceId}|${attemptAt}|${number || id}`;
    const durationSec = int(raw.durationSec, 6 * 3600);
    const ringSec = int(raw.ringSec, 6 * 3600);
    const connectAt = iso(raw.connectAt);
    const endAt = iso(raw.endAt);
    let finalStatus = status;
    if (!FINAL_STATUSES.has(status)) {
      finalStatus = connectAt && durationSec > 0 ? 'CONNECTED' : status === 'RINGING' || status === 'DIALING' ? 'FAILED' : status;
    }
    const recordingState = ['none', 'pending', 'uploaded', 'empty'].includes(String(raw.recordingState))
      ? String(raw.recordingState)
      : 'none';

    calls.push({
      id,
      idempotencyKey,
      deviceId,
      direction: DIRECTIONS.has(direction) ? direction : 'UNKNOWN',
      numberE164: number,
      numberHash,
      contactName: String(raw.contactName ?? '').slice(0, 200),
      attemptAt,
      ringStartAt: iso(raw.ringStartAt),
      connectAt,
      endAt,
      status: finalStatus,
      callLogType: Number.isFinite(Number(raw.callLogType)) ? Number(raw.callLogType) : null,
      durationSec,
      ringSec,
      simSlot: Number.isFinite(Number(raw.simSlot)) ? Number(raw.simSlot) : null,
      day: istDay(attemptAt),
      recordingState,
      recordingParts: int(raw.recordingParts, 60),
      audioSource: String(raw.audioSource ?? '').slice(0, 40),
    });
  }
  return { calls, errors };
}
