// util.ts — shared telecalling primitives (single source of truth).
//
// Split out of service.ts (Phase-3): every telecalling module chunks D1
// IN-lists, validates IST day strings, and stamps IST days. One definition —
// importing from './service' would cycle (service consumes these modules).
// Pure, edge-safe (no imports at all).

/** D1 bound-variable cap: chunk id lists at IN_BATCH. Raw `where: { id: { in:
// [...] } }` filters inline as bound params; D1 allows ~100/statement, and
// several readers swallow the throw (graceful degradation) — so an unchunked
// query fails SILENTLY. Every bulk read chunks at IN_BATCH. */
export const IN_BATCH = 90;

/** IST day string (YYYY-MM-DD). */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Canonical agent phone (founder 2026-11-05: phone-keyed NeoDove mapping).
 * Digits-only with inferred country code — `98888 12345`, `+919888812345`
 * and `09888812345` all collapse to `919888812345`, so roster `phone` and
 * NeoDove-side directory numbers join deterministically. Mirrors the
 * debtors-tracker `normalizePhone` (kept local: util.ts takes no imports).
 */
export function normalizeAgentPhone(raw: unknown): string {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

export function istDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
