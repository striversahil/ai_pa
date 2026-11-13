// ─────────────────────────────────────────────────────────────────────────────
// worker/http.ts — tiny request/response helpers shared by every route module.
//
// Canonical home for patterns that were copy-pasted per handler:
//   readBody(c)              ← `await c.req.json().catch(() => ({}))`
//   authErrorResponse(c, e)  ← `if (e instanceof AuthError) return c.json(...)`
//   writeError(c, e, fallback) ← domain-error → status, else AuthError, else 400
// Behavior is identical to the inline copies they replace.
// ─────────────────────────────────────────────────────────────────────────────
import { AuthError } from '../modules/auth/types';

/** Parsed JSON body, or `{}` when the body is missing/invalid (never throws). */
export async function readBody<T = any>(c: any): Promise<T> {
  return c.req.json().catch(() => ({})) as Promise<T>;
}

/** JSON error response for an AuthError (status from the error, default 403);
 *  returns null for any other error so the caller can rethrow/handle it. */
export function authErrorResponse(c: any, e: unknown): Response | null {
  if (e instanceof AuthError) return c.json({ error: e.message }, ((e as any).status ?? 403) as any);
  return null;
}

/**
 * Shared write-path error mapping. Replaces the per-file
 * `errorResponse` / `fail` copies in worker/routes/* (accounts,
 * debtors-tracker, master-data, ...). Identical behavior:
 * AuthError → its status; domain error with numeric `.status` → that status;
 * anything else → 400 with the fallback message. Pass `rethrowUnknown: true`
 * to rethrow status-less errors (master-data detail reads) instead of 400.
 */
export function writeError(
  c: any,
  e: unknown,
  fallback = 'request failed',
  opts?: { status?: number; rethrowUnknown?: boolean },
): Response {
  const auth = authErrorResponse(c, e);
  if (auth) return auth;
  const s = (e as any)?.status;
  if (typeof s === 'number') return c.json({ error: (e as any)?.message ?? fallback }, s as any);
  if (opts?.rethrowUnknown) throw e;
  return c.json({ error: (e as any)?.message ?? fallback }, (opts?.status ?? 400) as any);
}
