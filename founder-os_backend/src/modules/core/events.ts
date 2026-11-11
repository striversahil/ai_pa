// modules/core/events.ts — transactional outbox helpers + projector contract.
// Phase 0 stub: shapes only. Writers will append one core_domain_event row in
// the same D1 batch as the mutation; automations/notifications consume the
// stream via hlp_cursor (never by polling business tables).
import type { Actor } from './actor';

export interface DomainEventInput {
  actor: Actor;
  eventType: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown> | null;
  correlationId?: string | null;
}

export function buildDomainEvent(input: DomainEventInput): Record<string, unknown> {
  return {
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    payload: input.payload ? JSON.stringify(input.payload) : null,
    actorType: input.actor.type,
    actorId: input.actor.id,
    correlationId: input.correlationId ?? input.actor.requestId ?? null,
    occurredAt: new Date().toISOString(),
  };
}

/** Projectors (Phase 2+) are idempotent on (entityType, entityId, category). */
export function projectorDedupKey(entityType: string, entityId: string, category: string): string {
  return `${entityType}:${entityId}:${category}`;
}
