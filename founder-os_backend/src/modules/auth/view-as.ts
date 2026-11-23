// ─────────────────────────────────────────────────────────────────────────────
// modules/auth/view-as.ts — D1/session side of root "view as".
//
// Two responsibilities, both tiny:
//   1. resolve the TARGET's MeResponse (same snapshot the target would get), with
//      a 15s isolate cache — identical staleness guarantee as getMe();
//   2. write/close/list the `hlp_view_as` audit rows.
//
// The decision logic lives in ./view-as-pure.ts (no I/O); this file only fetches
// and persists, so the rules stay unit-testable.
// ─────────────────────────────────────────────────────────────────────────────
import type { AuthStore } from './store';
import type { MeResponse } from './types';
import { meFromSnapshot } from './service';
import { applyActingAs, viewAsBlocker, type ViewAsTarget } from './view-as-pure';

const TARGET_TTL_MS = 15_000;
const cache = new Map<string, { me: MeResponse; expiresAt: number }>();

/** Drop the resolved-target cache (used on enter/exit and by session invalidation). */
export function clearViewAsCache(): void {
  cache.clear();
}

/** The MeResponse `userId` would see for themselves, or null when they have no
 *  snapshot (deleted login). Cached per isolate for TARGET_TTL_MS. */
export async function targetMe(store: AuthStore, userId: string): Promise<MeResponse | null> {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.me;
  const me = meFromSnapshot(await store.getAuthSnapshot(userId));
  if (me) cache.set(userId, { me, expiresAt: Date.now() + TARGET_TTL_MS });
  else cache.delete(userId);
  return me;
}

/**
 * Overlay `real` onto the cookie's target id. Returns null when the overlay must
 * not apply (not root, unknown target, root target) — the caller then keeps the
 * real identity, so a stale/bogus cookie can never lock root out or escalate.
 */
export async function resolveViewAs(
  store: AuthStore,
  real: MeResponse,
  targetId: string,
): Promise<MeResponse | null> {
  const target = await targetMe(store, targetId);
  const targetShape: ViewAsTarget | null = target
    ? { id: target.user.id, email: target.user.email, name: target.user.name, isRoot: target.isRoot }
    : null;
  if (viewAsBlocker(real, targetShape) !== null || !target) return null;
  return applyActingAs(target, real);
}

// ── Audit trail (hlp_view_as) ────────────────────────────────────────────────
async function run(db: any, sql: string, ...params: any[]): Promise<void> {
  const stmt = db.prepare(sql);
  const bound = params.length && typeof stmt.bind === 'function' ? stmt.bind(...params) : stmt;
  await bound.run();
}

async function all(db: any, sql: string, ...params: any[]): Promise<any[]> {
  const stmt = db.prepare(sql);
  const bound = params.length && typeof stmt.bind === 'function' ? stmt.bind(...params) : stmt;
  const res: any = await bound.all();
  return (res?.results ?? []) as any[];
}

function newId(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `va_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export interface ViewAsMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/** Open an audit row for this root→target view. Never throws into the request
 *  path: an audit write failure must not stop the founder from looking. */
export async function logViewAsStart(
  db: any,
  real: MeResponse,
  target: MeResponse,
  meta: ViewAsMeta = {},
): Promise<void> {
  try {
    // Close anything left open by an expired cookie / closed tab first, so a
    // root has at most ONE open view at a time.
    await logViewAsEnd(db, real);
    await run(
      db,
      `INSERT INTO hlp_view_as
         (id, rootUserId, rootEmail, targetUserId, targetEmail, targetName, startedAt, endedAt, ip, userAgent)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      newId(),
      real.user.id,
      real.user.email ?? null,
      target.user.id,
      target.user.email ?? null,
      target.user.displayName || target.user.name || target.user.email || null,
      new Date().toISOString(),
      meta.ip ?? null,
      meta.userAgent ?? null,
    );
  } catch {
    /* audit is best-effort */
  }
}

/** Close every open view row for this root (idempotent). */
export async function logViewAsEnd(db: any, real: MeResponse): Promise<void> {
  try {
    await run(
      db,
      `UPDATE hlp_view_as SET endedAt = ? WHERE rootUserId = ? AND endedAt IS NULL`,
      new Date().toISOString(),
      real.user.id,
    );
  } catch {
    /* audit is best-effort */
  }
}

export interface ViewAsLogRow {
  id: string;
  rootEmail: string | null;
  targetEmail: string | null;
  targetName: string | null;
  startedAt: string;
  endedAt: string | null;
}

export async function listViewAs(db: any, limit = 50): Promise<ViewAsLogRow[]> {
  const rows = await all(
    db,
    `SELECT id, rootEmail, targetEmail, targetName, startedAt, endedAt
       FROM hlp_view_as ORDER BY startedAt DESC LIMIT ?`,
    Math.max(1, Math.min(200, Number(limit) || 50)),
  );
  return rows.map((r) => ({
    id: String(r?.id ?? ''),
    rootEmail: r?.rootEmail ?? null,
    targetEmail: r?.targetEmail ?? null,
    targetName: r?.targetName ?? null,
    startedAt: String(r?.startedAt ?? ''),
    endedAt: r?.endedAt ?? null,
  }));
}
