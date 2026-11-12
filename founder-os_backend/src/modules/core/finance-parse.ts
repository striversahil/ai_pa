// modules/core/finance-parse.ts — Phase 5b promise extraction (pure, no I/O).
// Framework-free: deterministic relative/explicit date parsing over free-text
// debtor remarks. Unparseable remarks return null (never guessed — same rule
// as master links). All days are IST YYYY-MM-DD strings.
//
// Supported (case-insensitive):
//   today | tomorrow | day after tomorrow | this week (Saturday) | next week (+7)
//   in|after|within N days | next month (last day) | this month / end of month
//   <weekday> (upcoming incl. today) | next <weekday> (+7)
//   5th nov | 5 nov | nov 5 | 05-11 | 05/11[/2026] (past dates kept past → broken)
// Anti-patterns (past references, not promises): yesterday | last week | ago
// Amount: Rs/₹/INR-prefixed numbers with k|thousand|l|lakh|lac|cr|crore.
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? '').slice(0, 10));
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function addDays(day: string, n: number): string {
  const p = parseYmd(day);
  if (!p) return day;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d) + n * 86400000);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function lastDayOfMonth(y: number, m: number): string {
  const dt = new Date(Date.UTC(y, m, 0));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function weekdayOf(day: string): number {
  const p = parseYmd(day);
  if (!p) return -1;
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

export interface ExtractedPromise {
  payByDate: string;
  amount: number | null;
}

export function extractPromiseDate(remark: string, remarkDay: string): string | null {
  const text = String(remark ?? '').toLowerCase().replace(/[^a-z0-9₹/.,\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || text === 'na' || text === 'n/a') return null;
  const ref = parseYmd(remarkDay) ? remarkDay.slice(0, 10) : '';
  if (!ref) return null;

  // Explicit month dates first (strongest signal).
  const m1 = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*/);
  const m2 = !m1 && text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s*(\d{1,2})(?:st|nd|rd|th)?/);
  const m3 = !m1 && !m2 && text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (m1 || m2) {
    const dayNum = Number(m1 ? m1[1] : m2![2]);
    const mon = MONTHS[(m1 ? m1[2] : m2![1]).slice(0, 3)];
    if (dayNum >= 1 && dayNum <= 31 && mon) {
      const year = Number(ref.slice(0, 4));
      const cand = ymd(year, mon, Math.min(dayNum, 28));
      // Clamp to month length safely.
      const last = lastDayOfMonth(year, mon);
      const fixed = cand > last ? last : cand;
      // Past explicit dates stay past (they read broken — truthful).
      return fixed;
    }
  }
  if (m3) {
    const a = Number(m3[1]);
    const b = Number(m3[2]);
    if (a >= 1 && a <= 31 && b >= 1 && b <= 12) {
      const year = m3[3] ? (m3[3].length === 2 ? 2000 + Number(m3[3]) : Number(m3[3])) : Number(ref.slice(0, 4));
      const last = lastDayOfMonth(year, b);
      const cand = ymd(year, b, Math.min(a, 28));
      return cand > last ? last : cand;
    }
  }

  if (/\btoday\b/.test(text)) return ref;
  if (/\bday after tomorrow\b/.test(text)) return addDays(ref, 2);
  if (/\btomorrow\b/.test(text)) return addDays(ref, 1);
  const nextWd = text.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (nextWd) {
    const target = WEEKDAYS[nextWd[1]];
    const cur = weekdayOf(ref);
    if (cur >= 0) return addDays(ref, ((target - cur + 7) % 7) + 7);
  }
  const wd = text.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (wd && !/next\s+(week|month)/.test(text)) {
    const target = WEEKDAYS[wd[1]];
    const cur = weekdayOf(ref);
    if (cur >= 0) return addDays(ref, (target - cur + 7) % 7);
  }
  if (/\bthis\s+week\b/.test(text)) {
    const cur = weekdayOf(ref);
    if (cur >= 0) return addDays(ref, (6 - cur + 7) % 7); // Saturday
  }
  if (/\bnext\s+week\b/.test(text)) return addDays(ref, 7);
  const inDays = text.match(/\b(?:in|after|within)\s+(\d{1,3})\s+days?\b/);
  if (inDays) return addDays(ref, Math.min(Number(inDays[1]), 365));
  if (/\bnext\s+month\b/.test(text)) {
    const p = parseYmd(ref)!;
    const nm = p.m === 12 ? 1 : p.m + 1;
    const ny = p.m === 12 ? p.y + 1 : p.y;
    return lastDayOfMonth(ny, nm);
  }
  if (/\b(this\s+month|end\s+of\s+(the\s+)?month)\b/.test(text)) {
    const p = parseYmd(ref)!;
    return lastDayOfMonth(p.y, p.m);
  }

  // Past references without a future anchor are not promises.
  return null;
}

export function extractPromiseAmount(remark: string): number | null {
  const text = String(remark ?? '').toLowerCase();
  const m = text.match(/(?:rs\.?|₹|inr|amount)\s*([\d,]+(?:\.\d{1,2})?)\s*(k|thousand|l|lakh|lac|cr|crore)?\b/);
  if (m) {
    const base = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(base) || base <= 0) return null;
    const mult = !m[2] ? 1 : m[2] === 'k' || m[2] === 'thousand' ? 1e3
      : m[2] === 'cr' || m[2] === 'crore' ? 1e7 : 1e5;
    return Math.round(base * mult);
  }
  // Bare lakh/crore without a Rs marker ("2 lakh", "1.5 cr") — the words
  // themselves are unambiguous money markers in Indian remarks.
  const bare = text.match(/\b([\d,]+(?:\.\d{1,2})?)\s*(lakh|lac|crore)\b/);
  if (bare) {
    const base = Number(bare[1].replace(/,/g, ''));
    if (!Number.isFinite(base) || base <= 0) return null;
    return Math.round(base * (bare[2] === 'crore' ? 1e7 : 1e5));
  }
  return null;
}

export function extractPromise(remark: string, remarkDay: string): ExtractedPromise | null {
  const payByDate = extractPromiseDate(remark, remarkDay);
  if (!payByDate) return null;
  return { payByDate, amount: extractPromiseAmount(remark) };
}

export type PromiseStatus = 'open' | 'kept' | 'broken';

export interface PromiseForStatus {
  promisedDate: string;
  startDay: string;
  customerName: string;
}

export interface CollectionForStatus {
  customerName: string;
  collectionDate: string;
}

/**
 * Derived on read (never stored): kept if a collection for the same customer
 * lands on/after the promise start day and on/before the pay-by date; broken
 * if today passes pay-by with no such collection; else open.
 */
export function derivePromiseStatus(
  p: PromiseForStatus,
  collections: CollectionForStatus[],
  today: string,
): PromiseStatus {
  const name = String(p.customerName ?? '').trim().toLowerCase();
  const start = String(p.startDay ?? '').slice(0, 10);
  const payBy = String(p.promisedDate ?? '').slice(0, 10);
  if (name && start && payBy) {
    const kept = (collections ?? []).some((c) => {
      if (String(c.customerName ?? '').trim().toLowerCase() !== name) return false;
      const d = String(c.collectionDate ?? '').slice(0, 10);
      return d >= start && d <= payBy;
    });
    if (kept) return 'kept';
  }
  if (payBy && String(today).slice(0, 10) > payBy) return 'broken';
  return 'open';
}
