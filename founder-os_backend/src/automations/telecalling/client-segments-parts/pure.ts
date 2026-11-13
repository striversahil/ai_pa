// Extracted verbatim from client-segments.ts by scripts/refactor/split-module.mjs.
// client-segments.ts re-exports everything public here, so existing imports keep working.
import type { ClientSegmentKind, MasterEntry, MasterIndex, ClientCandidate } from "./types";

export const LEGAL_RE = /\b(PVT|PRIVATE|LTD|LIMITED|LLP|INC|CO|COMPANY|CORP|CORPORATION)\b/g;

/** Canonical client key: upper-cased, bracket qualifiers + legal suffixes
 *  stripped. Both the override table and the matcher use this — never join
 *  on the raw customerName. */
export function normalizeClientKey(name: unknown): string {
  let s = String(name ?? '').toUpperCase();
  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.replace(/[^A-Z0-9 ]/g, ' ');
  s = s.replace(LEGAL_RE, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

export function tokensOf(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t.length >= 2);
}

/** Region write-back rule (pure): which Customer-Master resolutions are safe
 *  to WRITE onto an estimate's region. Stricter than the ledger on purpose —
 *  writes move deals between regions permanently, while the ledger only tops
 *  up targets (and already counts fuzzy ₹ via re-homing). Manual overrides
 *  (the sales-head's explicit per-client decision) always win; exact matches
 *  write only when every master row under the key sits in ONE region; fuzzy /
 *  ambiguous / region-less resolutions never write (row stays Unmapped for a
 *  human re-home). Mirror: backend enquiry-links.ts masterHomeRegions. */
export function pickWritebackRegion(entry: { matchKind?: unknown; masterRegion?: unknown } | null | undefined, exactRegions: string[]): string {
  const kind = String((entry as any)?.matchKind ?? '');
  const region = String((entry as any)?.masterRegion ?? '').trim();
  if (!/^(R1|R2|R3|R4)$/.test(region)) return '';
  if (kind === 'manual') return region;
  if (kind !== 'exact') return '';
  const uniq = [...new Set(exactRegions.map((r) => String(r ?? '').trim()).filter((r) => /^(R1|R2|R3|R4)$/.test(r)))];
  if (uniq.length !== 1) return '';
  return uniq[0] === region ? region : uniq[0];
}

/** Mill families count as end consumers unless a sales-head rule says
 *  otherwise (the rule table seeds exactly this; kept as a default so a
 *  fresh DB without the migration still resolves auto matches sanely). */
export function defaultSegmentFor(typeBase: string): ClientSegmentKind {
  const b = String(typeBase ?? '').trim();
  if (b === 'Flour Mill' || b === 'Chakki Mill' || b === 'Maida Plant') return 'consumer';
  return '';
}

export function isValidSegment(v: unknown): v is ClientSegmentKind {
  return v === 'consumer' || v === 'reseller' || v === '';
}

export function buildMasterIndex(master: MasterEntry[]): MasterIndex {
  const exact = new Map<string, number[]>();
  const tokenIdx = new Map<string, Set<number>>();
  const tokenSets: string[][] = [];
  master.forEach((m, i) => {
    const names = [m.displayName, m.companyName].map(normalizeClientKey).filter(Boolean);
    for (const n of names) {
      const list = exact.get(n) ?? [];
      if (!list.includes(i)) list.push(i);
      exact.set(n, list);
    }
    const toks = new Set<string>();
    for (const n of names) for (const t of tokensOf(n)) if (t.length > 2) toks.add(t);
    tokenSets.push([...toks]);
    for (const t of toks) {
      let s = tokenIdx.get(t);
      if (!s) { s = new Set(); tokenIdx.set(t, s); }
      s.add(i);
    }
  });
  return { exact, tokenIdx, tokenSets };
}

export function toCandidate(m: MasterEntry): ClientCandidate {
  return { id: m.id, name: m.displayName || m.companyName, typeBase: m.typeBase, region: m.region, state: m.state };
}
