// ─────────────────────────────────────────────────────────────────────────────
// modules/auth/view-as-pure.ts — the rules of root "view as" (impersonation).
//
// Pure: no I/O, no Hono, no D1. Everything here is a decision the platform makes
// from data it already has, so it can be unit-tested and mirrored by the guard.
//
// The transport is a COOKIE (not a swapped session, not a header): the whole app
// already authenticates by cookie, so an overlay cookie makes every existing
// fetch — dashboards, bell, chat unread, `<img>` — resolve as the target with no
// per-call plumbing. It is only ever honoured when the REAL session is root,
// and it can never write (see isReadOnlyViewAsRequest).
// ─────────────────────────────────────────────────────────────────────────────
import type { MeResponse } from './types';

export const VIEW_AS_COOKIE = 'fos_view_as';

/** Two hours. A forgotten tab must not keep impersonating tomorrow; the real
 *  root session is untouched, so "exit" is instant and lossless. */
export const VIEW_AS_MAX_AGE = 2 * 60 * 60;

/** The enter/exit endpoints live UNDER the read-only whitelist on purpose:
 *  you must be able to leave (and to start from a plain root session). */
export const VIEW_AS_PATH = '/api/auth/view-as';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Cookie value → user id, or null. Anything malformed is treated as absent
 *  (fail-closed: a mangled cookie must never impersonate somebody). */
export function cleanViewAsId(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s || s === 'root') return null;
  return ID_RE.test(s) ? s : null;
}

export function readViewAsCookie(cookieHeader?: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === VIEW_AS_COOKIE) return cleanViewAsId(decodeURIComponent(v.join('=')));
  }
  return null;
}

export function viewAsCookieHeader(userId: string, secure: boolean): string {
  const parts = [
    `${VIEW_AS_COOKIE}=${encodeURIComponent(userId)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${VIEW_AS_MAX_AGE}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearViewAsCookieHeader(secure: boolean): string {
  const parts = [`${VIEW_AS_COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export interface ViewAsTarget {
  id: string;
  email?: string | null;
  name?: string | null;
  isRoot?: boolean;
}

/**
 * May `real` view the platform as `target`? Returns the blocker reason, or null
 * when allowed. Root-only, never root→root, never self (a self overlay is a
 * no-op that would only confuse the exit path).
 */
export function viewAsBlocker(real: MeResponse | null, target: ViewAsTarget | null): string | null {
  if (!real) return 'Authentication required';
  if (!real.isRoot) return 'Root only — impersonation is a founder tool';
  if (!target) return 'Employee not found';
  if (target.isRoot) return 'The root user cannot be impersonated';
  if (target.id === real.user.id) return 'That is your own login — nothing to view';
  return null;
}

/**
 * The overlay: the target's scopes/roles/identity, plus `actingAs` so the UI can
 * show "viewing as …" and offer Exit. `isRoot` is forced false even if the data
 * somehow says otherwise — an impersonated request must never be root.
 */
export function applyActingAs(me: MeResponse, real: MeResponse): MeResponse {
  return {
    ...me,
    isRoot: false,
    isAdmin: !!me.isAdmin && !me.isRoot ? me.isAdmin : (me.scopes ?? []).includes('admin'),
    actingAs: {
      id: real.user.id,
      email: real.user.email,
      name: real.user.displayName || real.user.name || real.user.email,
    },
  };
}

/**
 * True when this method must be refused while impersonating. Reads are allowed
 * (that is the whole feature); every write is refused so the target's data is
 * never mutated and never attributed to the wrong person — including marking
 * their notifications read. Enter/exit stays open.
 */
export function isReadOnlyViewAsRequest(method: string, path: string): boolean {
  const m = String(method ?? '').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  if (String(path ?? '').startsWith(VIEW_AS_PATH)) return false;
  return true;
}
