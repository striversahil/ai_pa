// rotation.ts — assignment dealing: round-robin, MIS bulk moves, ledger chain.
//
// Verbatim extract from service.ts (Phase-3 split): the morning round-robin
// deal, the MIS bulk-assign path, and recordAssignment (the history-chain
// writer every other move funnels through). Reading/writing the
// EstimateAssignment chain lives here — and only here.
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import type { Telecaller } from '@prisma/client';
import { IN_BATCH, istDate } from './util';
import { invalidateRiskCache } from './risk';

// The conversion-specialist pool: only telecallers flagged to hold estimate
// follow-ups receive assignments (new deals + EOD re-poaching). Everyone else
// still generates leads but never holds estimates.
export async function getFollowUpSpecialists(): Promise<Telecaller[]> {
  return prisma.telecaller.findMany({ where: { assignEstimateFollowUps: true, deleted: false, absentSince: null }, orderBy: { order: 'asc' } });
}

// ── Round-robin rotation ─────────────────────────────────────────────────────
// Single source of truth: `Estimate.assignedTelecallerId`. No history table —
// every morning the whole active `sent` pool is re-dealt across the active
// roster, continuing from the previous rotation's stop point so consecutive
// mornings stay fair even when the sent-pool size changes.

const ROTATION_POINTER_KEY = 'telecalling_rotation:pointer';

async function getRotationPointer(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: ROTATION_POINTER_KEY } });
  return row ? String(row.value ?? '') : '';
}

async function setRotationPointer(telecallerId: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: ROTATION_POINTER_KEY },
    update: { value: telecallerId },
    create: { key: ROTATION_POINTER_KEY, value: telecallerId },
  });
}

/**
 * Deal every active `sent` estimate round-robin across active telecallers.
 * Runs once each morning (08:00 IST cron → POST /api/trigger/telecalling).
 */
export async function rotateEstimatesRoundRobin(): Promise<{ assigned: number }> {
  const telecallers = await getFollowUpSpecialists();
  if (telecallers.length === 0) return { assigned: 0 };

  const sent = await prisma.estimate.findMany({
    where: { status: 'sent', skipAssignment: false },
    orderBy: [{ date: 'asc' }, { estimateId: 'asc' }],
    select: { estimateId: true, lockedTelecallerId: true, assignedTelecallerId: true },
  });
  if (sent.length === 0) return { assigned: 0 };

  const lastId = await getRotationPointer();
  let idx = telecallers.findIndex((t) => t.id === lastId);
  idx = idx >= 0 ? (idx + 1) % telecallers.length : 0;

  let assigned = 0;
  let lastUsed = '';
  for (const est of sent) {
    // Locked estimates (MIS override) always go to their locked agent and are
    // never rotated away — "despite whatever the case".
    const locked = (est as any).lockedTelecallerId as string | null;
    const tcId = locked || telecallers[idx].id;
    lastUsed = tcId;
    if (!locked) idx = (idx + 1) % telecallers.length;
    await prisma.estimate.update({
      where: { estimateId: est.estimateId },
      data: { assignedTelecallerId: tcId },
    });
    assigned++;
  }

  if (lastUsed) await setRotationPointer(lastUsed);
  logger.info(
    { assigned, estimates: sent.length, telecallers: telecallers.length },
    'Round-robin estimate rotation complete',
  );
  return { assigned };
}

/**
 * Bulk assignment core — shared by the MIS controller endpoint and the
 * secret-gated ops runner endpoint. One-time assign: sets
 * Estimate.assignedTelecallerId + ledger rows, NO locks, NO score events or
 * penalties (a correction is never a snatch). Only `sent` estimates move;
 * anything else is reported as skipped. Temp-cover provenance is explicitly
 * cleared (these are real assignments, not absent covers).
 *
 * Runs on BOTH runtimes (module prisma is D1-shimmed in the worker build):
 * batched raw-SQL fast path with a sequential prisma-API fallback (the
 * fallback is also what the Express runtime uses, since real Prisma has no
 * .batch).
 */
export async function bulkAssignEstimates(
  moves: Array<{ estimateNumber?: string; estimateId?: string; telecallerId: string }>,
  opts?: { followUpAgents?: string[]; reason?: string },
): Promise<{
  moved: Array<Record<string, unknown>>;
  skipped: Array<Record<string, unknown>>;
  errors: Array<Record<string, unknown>>;
  flagsUpdated: string[];
}> {
  const reason = opts?.reason || 'MIS bulk assignment';
  const followUpAgents = opts?.followUpAgents ?? [];
  const moved: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];
  const errors: Array<Record<string, unknown>> = [];
  if (moves.length > 500) return { moved, skipped, errors: [{ error: 'max 500 moves per call' }], flagsUpdated: [] };

  // Resolve + validate everything BEFORE writing (fail fast per item).
  const plan: Array<{ estimateId: string; estimateNumber: string; from: string | null; to: string }> = [];
  for (const m of moves) {
    const ident = m.estimateNumber ?? m.estimateId;
    if (!ident || !m.telecallerId) { errors.push({ ident, error: 'estimateNumber/estimateId + telecallerId required' }); continue; }
    const est = m.estimateNumber
      ? await prisma.estimate.findFirst({ where: { estimateNumber: String(m.estimateNumber) } })
      : await prisma.estimate.findUnique({ where: { estimateId: String(m.estimateId) } });
    if (!est) { errors.push({ ident, error: 'estimate not found' }); continue; }
    if ((est as any).status !== 'sent') { skipped.push({ estimateNumber: (est as any).estimateNumber, status: (est as any).status, reason: 'not sent — left untouched' }); continue; }
    const tc = await prisma.telecaller.findUnique({ where: { id: String(m.telecallerId) } });
    if (!tc || (tc as any).deleted) { errors.push({ estimateNumber: (est as any).estimateNumber, error: 'target telecaller not found/deleted' }); continue; }
    if ((est as any).assignedTelecallerId === (tc as any).id) { skipped.push({ estimateNumber: (est as any).estimateNumber, reason: `already with ${(tc as any).name}` }); continue; }
    plan.push({ estimateId: (est as any).estimateId, estimateNumber: (est as any).estimateNumber, from: (est as any).assignedTelecallerId ?? null, to: (tc as any).id });
  }

  // Resolve open ledger rows for everything being moved (history chain).
  const openByEstimate = new Map<string, string>();
  if (plan.length > 0) {
    const ids = plan.map((p) => p.estimateId);
    // Chunked at IN_BATCH — D1 caps bound variables at 100/statement.
    for (let i = 0; i < ids.length; i += IN_BATCH) {
      const rows = await prisma.estimateAssignment.findMany({
        where: { estimateId: { in: ids.slice(i, i + IN_BATCH) }, status: 'assigned' },
      });
      for (const r of rows as any[]) openByEstimate.set(r.estimateId, r.id);
    }
  }

  const nowIso = new Date().toISOString();
  const day = istDate();
  const stmts: { sql: string; params: any[] }[] = [];
  for (const p of plan) {
    const priorOpenId = openByEstimate.get(p.estimateId) ?? null;
    stmts.push({ sql: 'UPDATE Estimate SET assignedTelecallerId = ? WHERE estimateId = ?', params: [p.to, p.estimateId] });
    if (priorOpenId) stmts.push({ sql: 'UPDATE EstimateAssignment SET status = ? WHERE id = ?', params: ['resolved', priorOpenId] });
    stmts.push({
      sql: 'INSERT INTO EstimateAssignment (id, estimateId, telecallerId, assignedAt, day, reassignedFromId, status, snatchReason, tempForTelecallerId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      params: [crypto.randomUUID(), p.estimateId, p.to, nowIso, day, priorOpenId, 'assigned', reason, null],
    });
  }
  try {
    for (let i = 0; i < stmts.length; i += 25) {
      await (prisma as any).batch(stmts.slice(i, i + 25));
    }
    for (const p of plan) moved.push({ estimateNumber: p.estimateNumber, from: p.from, to: p.to });
  } catch {
    // Fallback: sequential writes (also the Express-runtime path).
    for (const p of plan) {
      try {
        await prisma.estimate.update({ where: { estimateId: p.estimateId }, data: { assignedTelecallerId: p.to } });
        await recordAssignment(p.estimateId, p.to, reason, null);
        moved.push({ estimateNumber: p.estimateNumber, from: p.from, to: p.to, via: 'sequential-fallback' });
      } catch (e2: any) {
        errors.push({ estimateNumber: p.estimateNumber, error: e2?.message || String(e2) });
      }
    }
  }

  const flagsUpdated: string[] = [];
  for (const id of followUpAgents) {
    try {
      await prisma.telecaller.update({ where: { id: String(id) }, data: { assignEstimateFollowUps: true } as any });
      flagsUpdated.push(String(id));
    } catch (e: any) {
      errors.push({ telecallerId: id, error: e?.message || String(e) });
    }
  }

  if (moved.length > 0 || flagsUpdated.length > 0) {
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
  }
  return { moved, skipped, errors, flagsUpdated };
}

/**
 * Record an assignment into the EstimateAssignment chain (single source of truth
 * for fair close-credit). Resolves the previous open row first (if any), then
 * inserts the new holder linked via reassignedFromId. `snatchReason` (why the
 * previous holder lost it at EOD) is persisted so the losing agent sees exactly
 * what cost them the deal.
 */
export async function recordAssignment(estimateId: string, telecallerId: string, snatchReason: string | null = null, tempForTelecallerId?: string | null): Promise<void> {
  try {
    const current = await prisma.estimateAssignment.findFirst({
      where: { estimateId, status: 'assigned' },
      orderBy: { assignedAt: 'desc' },
    });
    let reassignedFromId: string | null = null;
    if (current) {
      await prisma.estimateAssignment.update({ where: { id: current.id }, data: { status: 'resolved' } });
      reassignedFromId = current.id;
    }
    await prisma.estimateAssignment.create({
      data: {
        estimateId, telecallerId, assignedAt: new Date(), day: istDate(), reassignedFromId, status: 'assigned',
        snatchReason,
        // Absentee-cover provenance: a temp-covered estimate that is re-poached
        // at EOD carries the ORIGINAL absent agent's id forward so it still
        // returns to her when she is marked present. Pass undefined to
        // auto-carry from the resolved row; pass null to explicitly clear
        // (e.g. when the estimate returns to the original holder).
        tempForTelecallerId: tempForTelecallerId === undefined
          ? (((current as any)?.tempForTelecallerId as string | undefined) ?? null)
          : tempForTelecallerId,
      },
    });
  } catch (e: any) {
    logger.warn({ err: e?.message, estimateId }, 'recordAssignment failed — continuing without history');
  }
}
