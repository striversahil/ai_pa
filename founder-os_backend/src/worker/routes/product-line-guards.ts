// routes/product-line-guards.ts — the gates + error mapping shared by the
// product-line route modules (kept out of the route files so each stays inside
// the 400-line budget).
import { adminScopeError } from '../context';
import { AuthError, ScopeKeys } from '../../modules/auth/types';
import { requireViewer } from '../viewer';

/** Quote + catalogue writes: whoever holds the `product-line` scope (or root). */
export async function requireQuoteScope(c: any): Promise<void> {
  const me = await requireViewer(c);
  if (me.isAdmin) return;
  const scopes = (me as any).scopes ?? [];
  if (!scopes.includes(ScopeKeys.ProductLine)) {
    throw new AuthError('FORBIDDEN', "Requires 'product-line' permission", 403);
  }
}

export function writeError(c: any, e: any) {
  // The caller's own message, one line, capped — never `[object Object]`.
  const raw = e && typeof e === 'object' && 'message' in e ? (e as any).message : e;
  const msg = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'write failed';
  if (/already exists/i.test(msg)) return c.json({ error: msg }, 409);
  // Map raw D1 errors to field messages — the UI must never see internals —
  // but keep the original text on the end: "no such column: VendorRate.x" is
  // the one line that makes a write debuggable.
  const nn = msg.match(/NOT NULL constraint failed:\s*[\w"]+\.([\w"]+)/i);
  if (nn) return c.json({ error: `${nn[1]} is required (${msg})` }, 400);
  const uq = msg.match(/UNIQUE constraint failed:\s*[\w"]+\.([\w"]+)/i);
  if (uq) return c.json({ error: `this ${uq[1]} already exists (${msg})` }, 409);
  if (/no such table|no such column/i.test(msg)) return c.json({ error: `database not ready — ${msg}` }, 503);
  // Surface the real reason. A generic "could not save" made a rejected AI
  // paste impossible to debug (founder ask 2026-11-23): every domain error in
  // this module is our own message and the D1 shapes are handled above, so
  // the raw text is safe and strictly more useful than a shrug.
  return c.json({ error: msg }, 400);
}

export { adminScopeError };
