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
