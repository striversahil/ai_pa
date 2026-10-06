// bulk-import/parse.ts — Step 0: pure, framework-free line splitting +
// regex commercial pre-extraction. ZERO AI: price/unit patterns catch most
// commercial lines without any model call (the model only verifies/fills
// gaps later). Shared by Worker + Express + the parse runner.

import type { ParsedLine } from './types';

function normLine(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Stable dedupe key: normalized text, numbers kept (₹1250 ≠ ₹1300). */
export function hashLine(s: string): string {
  const t = normLine(s).toLowerCase();
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
  return `h${h.toString(36)}`;
}

const UNIT_WORDS = [
  'sqft', 'sq\\.ft', 'sqm', 'kg', 'kgs', 'gram', 'gms?', 'meter', 'metre', 'mtr',
  'feet', 'ft', 'inch', 'pcs?', 'nos?', 'box', 'coil', 'roll', 'bag', 'ltr', 'litre',
  'toon', 'bdl', 'set', 'pair', 'mm', 'cm',
];
const UNIT_RE = new RegExp(`^(${UNIT_WORDS.join('|')})s?$`, 'i');

/** ₹1,250 / Rs. 1250.50 / 1250 per kg / @1250/kg — first sane money hit wins. */
const MONEY_RES = [
  /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i,
  /@\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\/|per\b)/i,
  /\b([\d,]{2,}(?:\.\d{1,2})?)\s*(?:\/|per\b)/i,
];

function parseMoneyToken(tok: string): number | null {
  for (const re of MONEY_RES) {
    const m = tok.match(re);
    if (m) {
      const n = Number(String(m[1]).replace(/,/g, ''));
      if (Number.isFinite(n) && n > 0 && n < 100_000_000) return Math.round(n * 100) / 100;
    }
  }
  return null;
}

/** Extract price + unit from one raw line without any model call. */
export function preExtractCommercials(raw: string): { price: number | null; unit: string | null } {
  let t = normLine(raw);
  if (!t) return { price: null, unit: null };
  // Strip dates FIRST — "9/24/2026" otherwise parses as price 24 (/24/).
  // Also strips leading serial/date runs like "208 9/24/2026".
  t = t.replace(/\b\d{1,4}\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' ').replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' ');
  const price = parseMoneyToken(t);
  let unit: string | null = null;
  // unit usually trails the price: "1250/kg", "1250 per sqft", "Rs 40 nos"
  const afterPrice = price != null ? t.slice(t.search(/[\d]/)) : t;
  const slash = afterPrice.match(/\/\s*([a-z.]+)\b/i);
  if (slash && UNIT_RE.test(slash[1])) unit = slash[1].toLowerCase();
  if (!unit) {
    const per = afterPrice.match(/\bper\s+([a-z.]+)\b/i);
    if (per && UNIT_RE.test(per[1])) unit = per[1].toLowerCase();
  }
  if (!unit) {
    // bare trailing unit word ("PVC tape 40 nos") — last token check only.
    const toks = t.split(' ').filter(Boolean);
    const last = (toks[toks.length - 1] ?? '').replace(/[^a-z.]/gi, '');
    if (last && UNIT_RE.test(last)) unit = last.toLowerCase();
  }
  return { price, unit };
}

/** Split pasted/CSV text into non-empty lines (CSV: one row per line; quoted
 *  commas preserved by joining continuation lines is NOT attempted — the
 *  runner uses a real CSV parser for files; paste is line-per-row). */
export function splitLines(text: string, maxRows = 2000): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const t = normLine(line.replace(/^["'\s]+|["'\s,;]+$/g, ''));
    if (!t || t.length < 2) continue;
    // skip header-ish lines ("S.No Item Rate ...") — no digits at all.
    if (!/\d/.test(t) && /^(s\.?no|sr|item|description|particulars|rate|price|list)/i.test(t)) continue;
    const { price, unit } = preExtractCommercials(t);
    out.push({ rawText: t.slice(0, 1000), rawHash: hashLine(t), price, unit });
    if (out.length >= maxRows) break;
  }
  return out;
}

/** Minimal CSV row split honoring double-quoted commas (for .csv text). */
export function splitCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells.map((c) => c.replace(/^"|"$/g, '').trim());
}

/** Join CSV cells back into one searchable line (specs stay in raw text for
 *  the extract step; price/unit pre-extracted from the joined line). */
export function csvLine(cells: string[]): string {
  return cells.filter(Boolean).join(' | ');
}
