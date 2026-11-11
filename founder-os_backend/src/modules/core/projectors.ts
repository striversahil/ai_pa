// modules/core/projectors.ts — Phase 2: estimate-followup projection +
// log-only escalation sweep. Idempotent: at most one OPEN action per
// (Estimate, estimateId, estimate_followup). Never throws to callers —
// projection failures are returned as { error } and the read proceeds.
import { logger } from '../../shared/logger';

const CATEGORY = 'estimate_followup';
const CLOSED_ESTIMATE = new Set(['accepted', 'declined', 'converted', 'cancelled', 'expired', 'void']);

function newId(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface ProjectionSummary {
  opened: number;
  reassigned: number;
  resolved: number;
  skipped: number;
  error?: string;
}

async function writeAudit(p: any, entityId: string, operation: string, changes: Record<string, unknown>, reason: string): Promise<void> {
  try {
    await p.coreAuditEvent.create({
      data: {
        id: newId(),
        actorType: 'SYSTEM',
        actorId: null,
        source: 'core-projector',
        entityType: 'core_action',
        entityId,
        operation,
        changes: JSON.stringify(changes),
        reason,
      },
    });
  } catch { /* audit best-effort */ }
}

/**
 * One OPEN follow-up action per currently-assigned estimate. Holder moves →
 * action reassigned (audited). Estimate closed → OPEN action auto-resolved.
 * Capped (default 500) to bound Worker CPU; reruns converge.
 */
export async function projectEstimateFollowups(p: any, limit = 500): Promise<ProjectionSummary> {
  const summary: ProjectionSummary = { opened: 0, reassigned: 0, resolved: 0, skipped: 0 };
  try {
    const [assignments, regions] = await Promise.all([
      p.estimateAssignment.findMany({ where: { status: 'assigned' }, orderBy: { assignedAt: 'desc' }, take: limit }),
      p.coreRegion.findMany({}).catch(() => []),
    ]);
    if (!assignments.length) return summary;
    const ids = [...new Set(assignments.map((a: any) => a.estimateId))];
    const [estimates, openActions] = await Promise.all([
      p.estimate.findMany({ where: { estimateId: { in: ids } } }).catch(() => []),
      p.coreAction.findMany({ where: { entityType: 'Estimate', category: CATEGORY, status: 'OPEN' } }).catch(() => []),
    ]);
    const estById = new Map((estimates as any[]).map((e) => [e.estimateId, e]));
    const actionByEst = new Map((openActions as any[]).filter((a) => a.entityId).map((a) => [a.entityId, a]));
    const regionByCode = new Map((regions as any[]).map((r: any) => [r.code, r.id]));

    for (const a of assignments as any[]) {
      const est = estById.get(a.estimateId);
      if (!est) { summary.skipped++; continue; }
      const existing = actionByEst.get(a.estimateId);
      if (CLOSED_ESTIMATE.has(String(est.status ?? '').toLowerCase())) {
        if (existing) {
          await p.coreAction.update({ where: { id: existing.id }, data: { status: 'DONE', completedBy: 'system', completedAt: nowIso(), updatedAt: nowIso() } });
          await writeAudit(p, existing.id, 'update', { autoResolve: true, estimateStatus: est.status }, 'core-projector: estimate closed');
          summary.resolved++;
        } else summary.skipped++;
        continue;
      }
      const title = `Follow up: ${String(est.customerName || est.title || 'customer').slice(0, 80)} · ${String(est.estimateNumber || a.estimateId).slice(0, 24)}`;
      const dueAt = (est as any).nextStepDate ?? null;
      const regionId = regionByCode.get(String((est as any).region ?? '')) ?? null;
      if (!existing) {
        const id = newId();
        await p.coreAction.create({
          data: {
            id, category: CATEGORY, title, entityType: 'Estimate', entityId: a.estimateId,
            assigneeId: a.telecallerId ?? null, departmentId: 'dept-sales', regionId,
            dueAt, priority: 'MEDIUM', status: 'OPEN',
            escalationPolicyId: 'estimate_followup', nextEscalationAt: dueAt,
          },
        });
        await writeAudit(p, id, 'create', { projector: CATEGORY, estimateId: a.estimateId }, 'core-projector: opened follow-up');
        summary.opened++;
      } else if (existing.assigneeId !== (a.telecallerId ?? null)) {
        await p.coreAction.update({ where: { id: existing.id }, data: { assigneeId: a.telecallerId ?? null, title, dueAt, regionId, updatedAt: nowIso() } });
        await writeAudit(p, existing.id, 'update', { reassignedTo: a.telecallerId ?? null }, 'core-projector: holder changed');
        summary.reassigned++;
      } else summary.skipped++;
    }
  } catch (e: any) {
    summary.error = e?.message ?? 'projection failed';
    try { logger.warn({ err: summary.error }, 'projectEstimateFollowups failed (non-blocking)'); } catch { /* never throw */ }
  }
  return summary;
}

export interface SweepSummary {
  checked: number;
  due: number;
  error?: string;
}

/**
 * Log-only escalation sweep (Phase 2): finds OPEN actions past their
 * nextEscalationAt and records WOULD_ESCALATE job rows. Sends nothing —
 * notifications enable in a later phase after threshold review.
 */
export async function sweepEscalationsLogOnly(p: any, assigneeIds: string[], limit = 200): Promise<SweepSummary> {
  const out: SweepSummary = { checked: 0, due: 0 };
  try {
    if (!assigneeIds.length) return out;
    const now = nowIso().slice(0, 10); // dueAt may be day-only; day compare
    const actions: any[] = await p.coreAction.findMany({ where: { status: 'OPEN', assigneeId: { in: assigneeIds } }, take: limit });
    out.checked = actions.length;
    const due = actions.filter((a) => a.nextEscalationAt && String(a.nextEscalationAt).slice(0, 10) <= now);
    if (!due.length) return out;
    const recent: any[] = await p.coreSystemJob.findMany({ take: 200 }).catch(() => []);
    const logged = new Set(
      recent
        .filter((j) => j.key === 'escalation-sweep' && String(j.startedAt ?? '').slice(0, 10) === now)
        .map((j) => { try { return JSON.parse(String(j.detail ?? '{}')).actionId; } catch { return null; } })
        .filter(Boolean),
    );
    for (const a of due) {
      if (logged.has(a.id)) continue;
      await p.coreSystemJob.create({
        data: {
          id: newId(), key: 'escalation-sweep', status: 'WOULD_ESCALATE',
          startedAt: nowIso(), finishedAt: nowIso(),
          detail: JSON.stringify({ actionId: a.id, assigneeId: a.assigneeId, category: a.category, dueAt: a.dueAt, level: a.escalationLevel ?? 0 }),
        },
      });
      out.due++;
    }
  } catch (e: any) {
    out.error = e?.message ?? 'sweep failed';
    try { logger.warn({ err: out.error }, 'sweepEscalationsLogOnly failed (non-blocking)'); } catch { /* never throw */ }
  }
  return out;
}
