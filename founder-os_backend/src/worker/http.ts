// ─────────────────────────────────────────────────────────────────────────────
// worker/http.ts — tiny request/response helpers shared by every route module.
//
// Canonical home for patterns that were copy-pasted per handler:
//   readBody(c)              ← `await c.req.json().catch(() => ({}))`
//   authErrorResponse(c, e)  ← `if (e instanceof AuthError) return c.json(...)`
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
