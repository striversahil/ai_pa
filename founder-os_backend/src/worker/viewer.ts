// ─────────────────────────────────────────────────────────────────────────────
// worker/viewer.ts — the signed-in viewer for one request.
//
// The ONLY place that resolves the session cookie into a MeResponse. Replaces
// the `getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null))`
// line that was repeated in ~56 handlers (sometimes several times per request).
// Memoised per request (keyed on the raw Request), so the auth gate in
// createApp() and the handler share one lookup.
//
// Deliberately imports modules/auth directly (not ../worker/context) so
// context.ts can import this file without a cycle.
// ─────────────────────────────────────────────────────────────────────────────
import { createAuthStore } from '../modules/auth/store';
import { getMe } from '../modules/auth/service';
import { readSessionCookie } from '../modules/auth/session';
import { readViewAsCookie } from '../modules/auth/view-as-pure';
import { resolveViewAs } from '../modules/auth/view-as';
import type { MeResponse } from '../modules/auth/types';
import { AuthError } from '../modules/auth/types';
import { resolveSelfTelecallerId } from '../modules/telecalling/self-roster';
import { expandScopes } from '../modules/auth/implied';

export interface Viewer {
  me: MeResponse | null;
  isAdmin: boolean;
  isRoot: boolean;
  /** Lower-cased resolved scopes (direct + role + implied bundle). */
  scopes: ReadonlySet<string>;
  /** Scope check on the lower-cased expanded set. Does NOT short-circuit for admins —
   *  call sites keep their own admin semantics. */
  has(scope: string): boolean;
}

const memo = new WeakMap<object, Promise<MeResponse | null>>();

/** MeResponse for this request (null when signed out). Same result + errors as
 *  getMe(authStore(c), readSessionCookie(cookie)), plus the root "view as"
 *  overlay: when root holds a valid `fos_view_as` cookie, this returns the
 *  TARGET's identity (with `actingAs`). One choke point means the auth gate and
 *  every handler — dashboards, bell, chat unread — scope themselves exactly
 *  like the target's own request, with no per-route impersonation code. */
export function getViewerMe(c: any): Promise<MeResponse | null> {
  const key = (c.req?.raw ?? c.req) as object;
  let p = memo.get(key);
  if (!p) {
    p = resolveMe(c);
    memo.set(key, p);
    // A failed lookup must not be cached for the rest of the request.
    p.catch(() => memo.delete(key));
  }
  return p;
}

async function resolveMe(c: any): Promise<MeResponse | null> {
  const store = createAuthStore(c.env);
  const cookie = c.req.header('cookie') ?? null;
  const real = await getMe(store, readSessionCookie(cookie));
  if (!real) return null;
  const targetId = readViewAsCookie(cookie);
  if (!targetId) return real;
  // Bogus / stale / non-root cookie → the REAL identity, never an error: a
  // broken overlay must not lock the founder out of their own account.
  return (await resolveViewAs(store, real, targetId)) ?? real;
}

/** The REAL session identity, ignoring any view-as overlay. Used by the
 *  enter/exit endpoints and the audit trail (they must name the actual root). */
export async function getRealMe(c: any): Promise<MeResponse | null> {
  return getMe(createAuthStore(c.env), readSessionCookie(c.req.header('cookie') ?? null));
}

export function toViewer(me: MeResponse | null): Viewer {
  // Backend owns the implied bundle (auth/implied.ts) — a `sales` login opens
  // `enquiry-tracker`, `sales-head` opens its 4Dashboard bundle, etc. without
  // needing every implied scope granted separately.
  const scopes = expandScopes((me?.scopes ?? []) as string[]);
  return {
    me,
    isAdmin: !!me?.isAdmin,
    isRoot: !!me?.isRoot,
    scopes,
    has: (scope: string) => scopes.has(String(scope).toLowerCase()),
  };
}

export async function getViewer(c: any): Promise<Viewer> {
  return toViewer(await getViewerMe(c));
}

/**
 * Signed-in viewer or throw 401. Replaces the per-file
 * `const me = await meFor(c); if (!me) throw new AuthError('UNAUTHENTICATED', ...)`
 * copies in worker/routes/* (master-data, debtors-tracker, ...). Identical
 * behavior: same error code/message/status.
 */
export async function requireViewer(c: any): Promise<NonNullable<Awaited<ReturnType<typeof getViewerMe>>>> {
  const me = await getViewerMe(c);
  if (!me) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
  return me;
}

/**
 * Roster id of the signed-in telecaller (null when signed out / no match).
 * Moved from worker/routes/automations.ts (still re-exported there).
 */
export async function resolveSelfTelecaller(c: any): Promise<string | null> {
  const me = await getViewerMe(c);
  if (!me) return null;
  return resolveSelfTelecallerId(me);
}
