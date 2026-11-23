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
  const msg = String(e?.message ?? 'write failed');
  if (/already exists/i.test(msg)) return c.json({ error: msg.slice(0, 300) }, 409);
  // Map raw D1 errors to field messages — the UI must never see internals.
  const nn = msg.match(/NOT NULL constraint failed:\s*[\w"]+\.([\w"]+)/i);
  if (nn) return c.json({ error: `${nn[1]} is required` }, 400);
  const uq = msg.match(/UNIQUE constraint failed:\s*[\w"]+\.([\w"]+)/i);
  if (uq) return c.json({ error: `this ${uq[1]} already exists` }, 409);
  if (/no such table|no such column/i.test(msg)) return c.json({ error: 'database not ready — try again in a minute' }, 503);
  return c.json({ error: 'could not save — check the fields and retry' }, 400);
}

export { adminScopeError };
