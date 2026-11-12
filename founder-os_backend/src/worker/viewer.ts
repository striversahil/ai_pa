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
import type { MeResponse } from '../modules/auth/types';
import { resolveSelfTelecallerId } from '../modules/telecalling/self-roster';

export interface Viewer {
  me: MeResponse | null;
  isAdmin: boolean;
  isRoot: boolean;
  /** Lower-cased resolved scopes (direct + role). */
  scopes: ReadonlySet<string>;
  /** Scope check on the lower-cased set. Does NOT short-circuit for admins —
   *  call sites keep their own admin semantics. */
  has(scope: string): boolean;
}

const memo = new WeakMap<object, Promise<MeResponse | null>>();

/** MeResponse for this request (null when signed out). Same result + errors as
 *  getMe(authStore(c), readSessionCookie(cookie)). */
export function getViewerMe(c: any): Promise<MeResponse | null> {
  const key = (c.req?.raw ?? c.req) as object;
  let p = memo.get(key);
  if (!p) {
    p = getMe(createAuthStore(c.env), readSessionCookie(c.req.header('cookie') ?? null));
    memo.set(key, p);
    // A failed lookup must not be cached for the rest of the request.
    p.catch(() => memo.delete(key));
  }
  return p;
}

export function toViewer(me: MeResponse | null): Viewer {
  const scopes = new Set(((me?.scopes ?? []) as string[]).map((s) => String(s).toLowerCase()));
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
 * Roster id of the signed-in telecaller (null when signed out / no match).
 * Moved from worker/routes/automations.ts (still re-exported there).
 */
export async function resolveSelfTelecaller(c: any): Promise<string | null> {
  const me = await getViewerMe(c);
  if (!me) return null;
  return resolveSelfTelecallerId(me);
}
