// modules/core/permissions.ts — one permission check for every core write/read.
// Phase 0 stub: signature only. Phase 1 seeds core_perm_rule / core_access_config
// and implements can() against position-roles ∪ direct grants.
import type { Actor } from './actor';

export type CoreAction2 =
  | 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE' | 'APPROVE' | 'TRANSITION' | 'EXPORT';
export type CoreScope = 'OWN' | 'TEAM' | 'REGION' | 'DEPARTMENT' | 'ALL';

export interface CheckInput {
  actor: Actor;
  entityType: string;
  action: CoreAction2;
  entity?: Record<string, unknown> | null;
}

export async function can(_input: CheckInput): Promise<boolean> {
  // Phase 0: no callers. Real implementation lands with the Phase 1 perm seed.
  void _input;
  return false;
}

export type CallerScope = 'ALL' | 'DEPARTMENT' | 'TEAM' | 'OWN';

export interface CallerContext {
  employeeId: string | null;
  scope: CallerScope;
  /** Employee ids whose actions this caller may read/complete. */
  visibleEmployeeIds: string[];
}

/**
 * Resolve the caller's work scope from their login link + positions + scopes.
 * Mirrors dashboard visibility: root/founder → ALL; sales-head/MIS scopes →
 * DEPARTMENT (all sales actions); TL1/TL2 → TEAM (both regions); else OWN.
 * Unlinked logins see nothing (never another region's queue).
 */
export async function resolveCaller(p: any, authUserId: string | null, me: { isRoot?: boolean; scopes?: string[] } | null): Promise<CallerContext> {
  const empty: CallerContext = { employeeId: null, scope: 'OWN', visibleEmployeeIds: [] };
  if (!authUserId) return empty;
  if (me?.isRoot) return { employeeId: null, scope: 'ALL', visibleEmployeeIds: [] };
  try {
    const link: any = await p.coreUserLink.findUnique({ where: { authUserId } }).catch(() => null);
    if (!link) return empty;
    const scopes = (me?.scopes ?? []).map((s) => String(s).toLowerCase());
    if (scopes.includes('sales-head') || scopes.includes('mis') || scopes.includes('user-admin')) {
      return { employeeId: link.employeeId, scope: 'DEPARTMENT', visibleEmployeeIds: [] };
    }
    const positions: any[] = await p.coreEmpPosition.findMany({ where: { employeeId: link.employeeId } }).catch(() => []);
    const primary = positions.find((x) => !x.validTo && x.isPrimary) ?? positions.find((x) => !x.validTo);
    if (primary && (primary.positionId === 'pos-tl1' || primary.positionId === 'pos-tl2')) {
      const regions: any[] = await p.coreEmpRegion.findMany({ where: { employeeId: link.employeeId } }).catch(() => []);
      const regionIds = regions.filter((r) => !r.validTo).map((r) => r.regionId);
      const peers: any[] = regionIds.length
        ? await p.coreEmpRegion.findMany({ where: { regionId: { in: regionIds } } }).catch(() => [])
        : [];
      const ids = new Set<string>([link.employeeId]);
      for (const x of peers) if (!x.validTo) ids.add(x.employeeId);
      return { employeeId: link.employeeId, scope: 'TEAM', visibleEmployeeIds: [...ids] };
    }
    return { employeeId: link.employeeId, scope: 'OWN', visibleEmployeeIds: [link.employeeId] };
  } catch {
    return empty;
  }
}
