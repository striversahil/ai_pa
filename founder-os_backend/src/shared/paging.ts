// ─────────────────────────────────────────────────────────────────────────────
// shared/paging.ts — the ONE server paging helper for every list screen.
//
// Founder standard (2026-11-21): page numbers (never load-more), 50 rows per
// page (max 100 per request), search over the WHOLE table server-side, and
// real totals from COUNT(*) — never `rows.length`. Lists that must stay
// complete (Management Active/Unprocessed, today's dispatches, overdue,
// procurement pending) do NOT use this.
//
// Edge-safe + dual-runtime: no Node deps; the D1 handle is passed in.
// Response shape is mirrored by founder-os_frontend/src/lib/paging.ts.
// ─────────────────────────────────────────────────────────────────────────────

export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 100;
/** D1 rejects LIKE patterns over 50 bytes; leave room for the two `%`. */
const LIKE_MAX_BYTES = 48;

export interface PageRequest {
  page: number;
  limit: number;
  offset: number;
  /** Trimmed search text ('' = no search). */
  q: string;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Read `?page=&limit=&q=` with the standard clamps. */
export function parsePageQuery(get: (key: string) => string | undefined): PageRequest {
  const page = Math.max(1, Math.floor(Number(get('page')) || 1));
  const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(Number(get('limit')) || PAGE_SIZE_DEFAULT)));
  const q = String(get('q') ?? '').trim().slice(0, 200);
  return { page, limit, offset: (page - 1) * limit, q };
}

export function pageResult<T>(rows: T[], total: number, req: Pick<PageRequest, 'page' | 'limit'>): Paged<T> {
  return { rows, total, page: req.page, limit: req.limit, totalPages: Math.max(1, Math.ceil(total / req.limit)) };
}

/** Escape LIKE wildcards, shortening the raw word until the escaped form
 *  fits D1's pattern limit (never leaves a dangling escape). */
function likeWord(word: string): string {
  const enc = new TextEncoder();
  const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  let raw = word;
  while (raw && enc.encode(esc(raw)).length > LIKE_MAX_BYTES) raw = raw.slice(0, -1);
  return esc(raw);
}

/**
 * Whole-table search clause: every word must appear in at least one column
 * (`word1 in (a OR b) AND word2 in (a OR b)`), case-insensitive LIKE.
 * Returns '' when there is nothing to search. `alsoMatch(word)` may add one
 * extra alternative per word (e.g. phone digits: "98765-43210" → 9876543210).
 */
export function searchClause(
  columns: readonly string[],
  q: string,
  alsoMatch?: (word: string) => { sql: string; binds: string[] } | null,
): { sql: string; binds: string[] } {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length || !columns.length) return { sql: '', binds: [] };
  const parts: string[] = [];
  const binds: string[] = [];
  for (const w of words) {
    const pattern = `%${likeWord(w)}%`;
    const alts = columns.map((c) => `LOWER(COALESCE(${c}, '')) LIKE ? ESCAPE '\\'`);
    for (let i = 0; i < columns.length; i++) binds.push(pattern);
    const extra = alsoMatch?.(w);
    if (extra?.sql) { alts.push(extra.sql); binds.push(...extra.binds); }
    parts.push(`(${alts.join(' OR ')})`);
  }
  return { sql: parts.join(' AND '), binds };
}

/** `%…%` LIKE pattern for one raw value (escaped, D1 length-capped). */
export function likePattern(value: string): string {
  return `%${likeWord(value.toLowerCase())}%`;
}

export interface PagedSql {
  /** Column list, e.g. `r.*, v.name AS vendorName`. */
  select: string;
  /** FROM + JOINs, e.g. `VendorRate r LEFT JOIN Vendor v ON v.id = r.vendorId`. */
  from: string;
  /** WHERE conditions joined with AND (empty strings skipped). */
  where: string[];
  binds: unknown[];
  /** Must end in a unique column so pages never overlap, e.g. `r.quotedAt DESC, r.id DESC`. */
  orderBy: string;
}

/** One page + the COUNT(*) total in a single D1 round trip. */
export async function pagedQuery<T = Record<string, unknown>>(db: any, sql: PagedSql, req: PageRequest): Promise<Paged<T>> {
  const conds = sql.where.filter(Boolean);
  const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
  const [page, count] = await db.batch([
    db.prepare(`SELECT ${sql.select} FROM ${sql.from}${where} ORDER BY ${sql.orderBy} LIMIT ? OFFSET ?`).bind(...sql.binds, req.limit, req.offset),
    db.prepare(`SELECT COUNT(*) AS total FROM ${sql.from}${where}`).bind(...sql.binds),
  ]);
  const rows = ((page as any)?.results ?? []) as T[];
  const total = Number(((count as any)?.results ?? [])[0]?.total ?? 0);
  return pageResult(rows, total, req);
}
