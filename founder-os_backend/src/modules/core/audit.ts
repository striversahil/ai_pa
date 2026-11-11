// modules/core/audit.ts — audit helpers. Phase 0 stub: shapes only.
// Every core write batch will insert one core_row_change row (full before/after)
// plus one core_audit_event row (business reason) in the same DB.batch().
import type { Actor } from './actor';

export interface AuditInput {
  actor: Actor;
  source: string;
  entityType: string;
  entityId: string;
  operation: string;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
  reason?: string | null;
  requestId?: string | null;
}

export function buildRowChange(input: AuditInput, tableName: string, rowId: string): Record<string, unknown> {
  return {
    schemaName: 'core',
    tableName,
    rowId,
    operation: input.operation,
    changedFields: input.changes ? Object.keys(input.changes) : [],
    oldData: null,
    newData: null,
    actorType: input.actor.type,
    actorId: input.actor.id,
    requestId: input.requestId ?? input.actor.requestId ?? null,
    dbUser: 'worker',
  };
}
