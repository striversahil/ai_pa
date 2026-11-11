// modules/core/actor.ts — who is acting. Phase 0 stub: shape only, no callers yet.
// The core service layer will set actor context on every write batch so
// core_row_change / core_audit_event attribute every mutation.
export type ActorType = 'EMPLOYEE' | 'SERVICE_ACCOUNT' | 'SYSTEM';

export interface Actor {
  type: ActorType;
  id: string | null;
  requestId?: string | null;
}

export function systemActor(requestId?: string): Actor {
  return { type: 'SYSTEM', id: null, requestId: requestId ?? null };
}

export function actorLabel(a: Actor): string {
  return `${a.type}:${a.id ?? 'null'}`;
}
