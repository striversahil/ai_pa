// routes/sales-access.ts — the one sales-head gate for region-model writes.
// Root/admin always pass; a sales-head role holder is authorized even if the
// scope grant is missing from their session (same rule as the roster writes).
import { adminGuard, isApproved } from "../context";
import { requireViewer } from "../viewer";
import { ScopeKeys } from "../../modules/auth/types";

export async function requireSalesManager(c: any): Promise<boolean> {
  if ((await adminGuard(c)) === null) return true;
  const me: any = await requireViewer(c).catch(() => null);
  if (!me) return false;
  if (!isApproved(me)) return false;
  const scopes: string[] = me.scopes ?? [];
  const roles: string[] = me.roles ?? [];
  return scopes.includes(ScopeKeys.SalesHead) || roles.includes("sales-head") || !!me.isAdmin;
}