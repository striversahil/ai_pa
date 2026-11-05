// client-segments.ts — final-consumer vs reseller classification.
//
// Founder decision (2026-11-02): each sales region owes ₹1L/day of ACCEPTED
// value from END CONSUMERS only. The customer master types every mill
// (Flour Mill / Chakki Mill / Maida Plant) but never flags resellers, and an
// Estimate carries only a free-text customerName — no customer id — so the
// join below is name-keyed and deterministic:
//
//   ClientTypeRule  one row per master customerTypeBase: which segment that
//                   whole family belongs to (sales-head editable; the three
//                   mill families seed as consumer).
//   ClientSegment   MANUAL overrides only, keyed by normalised client name.
//                   Auto matches are computed on read and never stored; a
//                   manual row always wins.
//
// Resolution order per client: manual override → auto master match (exact,
// then unique token-overlap ≥ 0.6) mapped through the type rules → unset.
// Ambiguous (2+ equal-best masters) and unmatched clients surface in the
// Controller queue with up to 5 candidates instead of being guessed.
import { getD1Database } from '../../shared/prisma-d1';
import { cacheDelPrefix } from '../../shared/cache';
import { logger } from '../../shared/logger';
import { listAllCustomers } from '../../modules/master-data/store';

export type ClientSegmentKind = 'consumer' | 'reseller' | '';

export interface ClientCandidate {
  id: string;
  name: string;
  typeBase: string;
  region: string;
  state: string;
}

export interface ClientClass {
  /** Normalised client key (normalizeClientKey of the estimate name). */
  key: string;
  displayName: string;
  segment: ClientSegmentKind;
  /** manual = sales-head override; auto = master match; none = needs review. */
  source: 'manual' | 'auto' | 'none';
  masterCustomerId: string;
  masterName: string;
  /** Master region (R1–R4, '' when unmatched) — drives sales-head direct re-homing. */
  masterRegion: string;
  matchKind: 'exact' | 'fuzzy-unique' | 'fuzzy-best' | 'ambiguous' | 'none' | 'manual';
  candidates: ClientCandidate[];
}

export interface ClientQueueRow {
  key: string;
  displayName: string;
  segment: ClientSegmentKind;
  source: 'manual' | 'auto' | 'none';
  masterName: string;
  matchKind: string;
  candidates: ClientCandidate[];
  regions: string[];
  estimateCount: number;
  acceptedCount: number;
  acceptedValue: number;
  declinedCount: number;
  declinedValue: number;
  estimates: Array<{
    estimateId: string;
    estimateNumber: string;
    customerName: string;
    total: number;
    region: string;
    status: string;
    day: string;
  }>;
}

const LEGAL_RE = /\b(PVT|PRIVATE|LTD|LIMITED|LLP|INC|CO|COMPANY|CORP|CORPORATION)\b/g;

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

function tokensOf(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t.length >= 2);
}

/** Mill families count as end consumers unless a sales-head rule says
 *  otherwise (the rule table seeds exactly this; kept as a default so a
 *  fresh DB without the migration still resolves auto matches sanely). */
function defaultSegmentFor(typeBase: string): ClientSegmentKind {
  const b = String(typeBase ?? '').trim();
  if (b === 'Flour Mill' || b === 'Chakki Mill' || b === 'Maida Plant') return 'consumer';
  return '';
}

function isValidSegment(v: unknown): v is ClientSegmentKind {
  return v === 'consumer' || v === 'reseller' || v === '';
}

// ── Reads (fail-open: no DB → empty maps, dashboard still renders) ──────────

async function loadTypeRules(): Promise<Map<string, ClientSegmentKind>> {
  const out = new Map<string, ClientSegmentKind>();
  try {
    const db = getD1Database() as any;
    if (!db) return out;
    const res = await db.prepare('SELECT typeBase, segment FROM ClientTypeRule').all();
    for (const r of (res?.results ?? []) as any[]) {
      const base = String(r?.typeBase ?? '').trim();
      if (!base) continue;
      out.set(base, isValidSegment(r?.segment) ? (r.segment as ClientSegmentKind) : '');
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'client-segments: type rules read failed');
  }
  return out;
}

async function loadManuals(): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  try {
    const db = getD1Database() as any;
    if (!db) return out;
    const res = await db.prepare('SELECT clientKey, displayName, segment, masterCustomerId, masterName, matchKind FROM ClientSegment').all();
    for (const r of (res?.results ?? []) as any[]) {
      const key = String(r?.clientKey ?? '').trim();
      if (!key) continue;
      out.set(key, r);
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'client-segments: manual overrides read failed');
  }
  return out;
}

interface MasterEntry {
  id: string;
  displayName: string;
  companyName: string;
  typeBase: string;
  region: string;
  state: string;
}

async function loadMasterEntries(): Promise<MasterEntry[]> {
  try {
    const rows = await listAllCustomers();
    return ((rows ?? []) as any[]).map((r) => ({
      id: String(r?.id ?? ''),
      displayName: String(r?.displayName ?? ''),
      companyName: String(r?.companyName ?? ''),
      typeBase: String(r?.customerTypeBase ?? r?.typeBase ?? ''),
      region: String(r?.region ?? ''),
      state: String(r?.state ?? ''),
    })).filter((r) => r.id && (r.displayName || r.companyName));
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'client-segments: master list read failed');
    return [];
  }
}

// ── Matching (pure) ─────────────────────────────────────────────────────────

interface MasterIndex {
  exact: Map<string, number[]>;
  tokenIdx: Map<string, Set<number>>;
  tokenSets: string[][];
}

function buildMasterIndex(master: MasterEntry[]): MasterIndex {
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

function toCandidate(m: MasterEntry): ClientCandidate {
  return { id: m.id, name: m.displayName || m.companyName, typeBase: m.typeBase, region: m.region, state: m.state };
}

/** Classify distinct client names. Pure apart from the three reads above. */
export async function classifyClients(names: string[]): Promise<Map<string, ClientClass>> {
  const out = new Map<string, ClientClass>();
  const keys = [...new Set(names.map((n) => ({ raw: n, key: normalizeClientKey(n) })).filter((x) => x.key).map((x) => x.key))];
  if (keys.length === 0) return out;
  const [rules, manuals, master] = await Promise.all([loadTypeRules(), loadManuals(), loadMasterEntries()]);
  const idx = buildMasterIndex(master);
  const rawByKey = new Map<string, string>();
  for (const n of names) {
    const k = normalizeClientKey(n);
    if (k && !rawByKey.has(k)) rawByKey.set(k, String(n ?? '').trim());
  }

  for (const key of keys) {
    const displayName = rawByKey.get(key) ?? key;
    const manual = manuals.get(key);
    if (manual && isValidSegment(manual.segment) && manual.segment) {
      const manualMasterId = String(manual.masterCustomerId ?? '');
      const manualMaster = master.find((m) => m.id === manualMasterId) ?? null;
      out.set(key, {
        key, displayName,
        segment: manual.segment as ClientSegmentKind,
        source: 'manual',
        masterCustomerId: manualMasterId,
        masterName: String(manual.masterName ?? manualMaster?.displayName ?? manualMaster?.companyName ?? ''),
        masterRegion: manualMaster ? String(manualMaster.region ?? '') : '',
        matchKind: 'manual',
        candidates: [],
      });
      continue;
    }
    const exactHit = idx.exact.get(key) ?? [];
    if (exactHit.length > 0) {
      const m = master[exactHit[0]];
      const seg = rules.has(m.typeBase) ? (rules.get(m.typeBase) as ClientSegmentKind) : defaultSegmentFor(m.typeBase);
      out.set(key, {
        key, displayName,
        segment: seg, source: seg ? 'auto' : 'none',
        masterCustomerId: seg ? m.id : '',
        masterName: seg ? (m.displayName || m.companyName) : '',
        masterRegion: m ? String(m.region ?? '') : '',
        matchKind: 'exact',
        candidates: seg ? [] : exactHit.slice(0, 5).map((i) => toCandidate(master[i])),
      });
      continue;
    }
    // Token-overlap fuzzy: candidates sharing any long token, score =
    // shared ÷ estimate tokens, bar at 0.6.
    const estToks = tokensOf(key);
    const candSet = new Set<number>();
    for (const t of estToks) {
      if (t.length <= 2) continue;
      for (const i of idx.tokenIdx.get(t) ?? []) candSet.add(i);
    }
    const scored: Array<{ i: number; score: number }> = [];
    for (const i of candSet) {
      const mt = new Set(idx.tokenSets[i]);
      let shared = 0;
      for (const t of estToks) if (mt.has(t)) shared++;
      const score = estToks.length > 0 ? shared / estToks.length : 0;
      if (score >= 0.6) scored.push({ i, score });
    }
    scored.sort((a, b) => b.score - a.score);
    if (scored.length === 0) {
      out.set(key, {
        key, displayName, segment: '', source: 'none',
        masterCustomerId: '', masterName: '', masterRegion: '', matchKind: 'none', candidates: [],
      });
      continue;
    }
    const top = scored[0].score;
    const best = scored.filter((s) => s.score === top);
    if (best.length === 1) {
      const m = master[best[0].i];
      const seg = rules.has(m.typeBase) ? (rules.get(m.typeBase) as ClientSegmentKind) : defaultSegmentFor(m.typeBase);
      out.set(key, {
        key, displayName,
        segment: seg, source: seg ? 'auto' : 'none',
        masterCustomerId: seg ? m.id : '',
        masterName: seg ? (m.displayName || m.companyName) : '',
        masterRegion: m ? String(m.region ?? '') : '',
        matchKind: scored.length === 1 ? 'fuzzy-unique' : 'fuzzy-best',
        candidates: seg ? [] : scored.slice(0, 5).map((s) => toCandidate(master[s.i])),
      });
      continue;
    }
    out.set(key, {
      key, displayName, segment: '', source: 'none',
      masterCustomerId: '', masterName: '', masterRegion: '', matchKind: 'ambiguous',
      candidates: best.slice(0, 5).map((s) => toCandidate(master[s.i])),
    });
  }
  return out;
}

/** Controller queue: accepted + declined estimates in [from, to] grouped by
 *  client, with the match candidates for every unclear row. */
export async function loadClientQueue(from: string, to: string): Promise<{ clients: ClientQueueRow[]; typeBases: Array<{ base: string; count: number; segment: string }> }> {
  const { prisma } = await import('../../shared/prisma');
  let rows: any[] = [];
  try {
    rows = (await prisma.estimate.findMany({
      where: {
        status: { in: ['accepted', 'confirmed', 'declined'] },
        OR: [
          { acceptedAt: { gte: from, lte: to } },
          { declinedAt: { gte: from, lte: to } },
          { acceptedAt: null, declinedAt: null, date: { gte: from, lte: to } },
        ],
      },
      select: {
        estimateId: true, estimateNumber: true, customerName: true, total: true,
        region: true, status: true, acceptedAt: true, declinedAt: true, date: true,
      },
      orderBy: { total: 'desc' },
    })) as any[];
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'client-segments: queue estimate read failed');
  }
  const names = rows.map((r) => String(r?.customerName ?? ''));
  const classes = await classifyClients(names);
  const [rules] = await Promise.all([loadTypeRules()]);
  // Unique master type bases for the rule editor (with master row counts).
  let master: MasterEntry[] = [];
  try { master = await loadMasterEntries(); } catch { /* already warned */ }
  const baseCount = new Map<string, number>();
  for (const m of master) baseCount.set(m.typeBase || 'Unspecified', (baseCount.get(m.typeBase || 'Unspecified') ?? 0) + 1);
  const typeBases = [...baseCount.entries()]
    .map(([base, count]) => ({ base, count, segment: rules.get(base) ?? defaultSegmentFor(base) ?? '' }))
    .sort((a, b) => b.count - a.count);

  const groups = new Map<string, ClientQueueRow>();
  for (const r of rows) {
    const key = normalizeClientKey(r?.customerName);
    if (!key) continue;
    const cls = classes.get(key);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        displayName: String(r?.customerName ?? '').trim(),
        segment: cls?.segment ?? '',
        source: cls?.source ?? 'none',
        masterName: cls?.masterName ?? '',
        matchKind: cls?.matchKind ?? 'none',
        candidates: cls?.candidates ?? [],
        regions: [],
        estimateCount: 0,
        acceptedCount: 0,
        acceptedValue: 0,
        declinedCount: 0,
        declinedValue: 0,
        estimates: [],
      };
      groups.set(key, g);
    }
    const total = Number(r?.total ?? 0) || 0;
    const status = String(r?.status ?? '');
    g.estimateCount += 1;
    if (status === 'declined') { g.declinedCount += 1; g.declinedValue += total; }
    else { g.acceptedCount += 1; g.acceptedValue += total; }
    const region = String(r?.region ?? '').trim();
    if (region && !g.regions.includes(region)) g.regions.push(region);
    if (g.estimates.length < 10) {
      g.estimates.push({
        estimateId: String(r?.estimateId ?? ''),
        estimateNumber: String(r?.estimateNumber ?? ''),
        customerName: String(r?.customerName ?? ''),
        total,
        region,
        status,
        day: String(r?.acceptedAt ?? r?.declinedAt ?? r?.date ?? '').slice(0, 10),
      });
    }
  }
  const clients = [...groups.values()].sort((a, b) =>
    (b.acceptedValue + b.declinedValue) - (a.acceptedValue + a.declinedValue),
  );
  return { clients, typeBases };
}

// ── Writes (sales-head / MIS only — routes enforce the gate) ────────────────

export async function setTypeRule(
  typeBase: unknown, segment: unknown, by: string, byName: string,
): Promise<{ base: string; segment: ClientSegmentKind }> {
  const base = String(typeBase ?? '').trim().slice(0, 80);
  if (!base) throw new Error('typeBase is required');
  if (!isValidSegment(segment)) throw new Error("segment must be 'consumer', 'reseller' or '' (unset)");
  const db = getD1Database() as any;
  if (!db) throw new Error('database not ready');
  const iso = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO ClientTypeRule (typeBase, segment, updatedBy, updatedByName, updatedAt)
       VALUES (?,?,?,?,?)
       ON CONFLICT(typeBase) DO UPDATE SET segment = excluded.segment, updatedBy = excluded.updatedBy,
         updatedByName = excluded.updatedByName, updatedAt = excluded.updatedAt`,
    )
    .bind(base, segment, String(by ?? ''), String(byName ?? ''), iso)
    .run();
  await cacheDelPrefix('telecalling:dashboard:');
  return { base, segment: segment as ClientSegmentKind };
}

export async function setManualSegment(
  clientKey: unknown, segment: unknown, opts: { masterCustomerId?: unknown; masterName?: unknown; decidedBy?: string; decidedByName?: string },
): Promise<{ key: string; segment: ClientSegmentKind; cleared: boolean }> {
  const rawKey = String(clientKey ?? '').trim();
  const key = /^[A-Z0-9 ]{2,120}$/.test(rawKey) ? rawKey : normalizeClientKey(rawKey);
  if (!key) throw new Error('clientKey is required');
  if (!isValidSegment(segment)) throw new Error("segment must be 'consumer', 'reseller' or '' (clear)");
  const db = getD1Database() as any;
  if (!db) throw new Error('database not ready');
  if (!segment) {
    await db.prepare('DELETE FROM ClientSegment WHERE clientKey = ?').bind(key).run();
    await cacheDelPrefix('telecalling:dashboard:');
    return { key, segment: '', cleared: true };
  }
  // Display/master names are looked up server-side — the client only sends the
  // key + segment (+ optional master pick), so a crafted display name can
  // never be injected into the ledger.
  const iso = new Date().toISOString();
  let displayName = key;
  let masterId = String(opts.masterCustomerId ?? '');
  let masterName = String(opts.masterName ?? '');
  if (masterId) {
    try {
      const row: any = await db.prepare('SELECT displayName, companyName FROM MasterCustomer WHERE id = ?').bind(masterId).first();
      if (row) {
        masterName = String(row.displayName || row.companyName || '');
        if (!masterName) throw new Error('unknown master customer');
      } else {
        throw new Error('unknown master customer');
      }
    } catch (e: any) {
      if (String(e?.message ?? '').includes('unknown master')) throw e;
      // Master table not applied yet — store the link without validation.
    }
  }
  await db
    .prepare(
      `INSERT INTO ClientSegment (clientKey, displayName, segment, masterCustomerId, masterName, matchKind, decidedBy, decidedByName, createdAt, updatedAt)
       VALUES (?,?,?,?,?,'manual',?,?,?,?)
       ON CONFLICT(clientKey) DO UPDATE SET displayName = excluded.displayName, segment = excluded.segment,
         masterCustomerId = excluded.masterCustomerId, masterName = excluded.masterName, matchKind = 'manual',
         decidedBy = excluded.decidedBy, decidedByName = excluded.decidedByName, updatedAt = excluded.updatedAt`,
    )
    .bind(key, displayName, segment, masterId, masterName, String(opts.decidedBy ?? ''), String(opts.decidedByName ?? ''), iso, iso)
    .run();
  await cacheDelPrefix('telecalling:dashboard:');
  return { key, segment: segment as ClientSegmentKind, cleared: false };
}
