// roster.ts — telecaller roster sync + absentee cover.
//
// Verbatim extract from service.ts (Phase-3 split): NeoDove-backed roster
// seeding plus the MIS absent/present flow (temp-cover redistribution with
// history-chain provenance). No scoring here — redistribution is never a
// snatch and writes no score events.
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import type { Telecaller } from '@prisma/client';
import { getAllNeodoveAgents } from '../neodove-telecaller-report';
import { IN_BATCH, istDate } from './util';
import { invalidateRiskCache } from './risk';
import { recordAssignment } from './rotation';

/**
 * Idempotently seed the Telecaller roster

/**
 * Idempotently seed the Telecaller roster from the unique NeoDove agents across
 * ALL stored report days. Each unique agent (by NeoDove userId/userName) becomes
 * an active Telecaller; existing rows are linked (neodoveUserId/userName) without
 * changing their name/order/active state. No-op once the roster already covers
 * every agent, so it is safe to call on every dashboard load.
 */
async function syncTelecallersFromNeodove(): Promise<void> {
  try {
    const agents = await getAllNeodoveAgents();
    if (agents.length === 0) return;

    const existing = (await prisma.telecaller.findMany()) as (Telecaller & {
      neodoveUserId: string | null;
      neodoveUserName: string | null;
    })[];
    const byId = new Map<string, (typeof existing)[number]>();
    const byName = new Map<string, (typeof existing)[number]>();
    for (const t of existing) {
      if (t.neodoveUserId) byId.set(t.neodoveUserId, t);
      if (t.neodoveUserName) byName.set(t.neodoveUserName, t);
    }

    let writesNeeded = 0;
    for (const a of agents) {
      const existingT =
        (a.userId && byId.get(a.userId)) || (a.userName && byName.get(a.userName));
      if (existingT) {
        if (!existingT.neodoveUserId || !existingT.neodoveUserName) writesNeeded++;
      } else {
        writesNeeded++;
      }
    }
    if (writesNeeded === 0) return; // already fully synced

    let maxOrder = existing.reduce((m, t) => Math.max(m, t.order ?? 0), 0);
    for (const a of agents) {
      const existingT =
        (a.userId && byId.get(a.userId)) || (a.userName && byName.get(a.userName));
      if (existingT) {
        if (!existingT.neodoveUserId || !existingT.neodoveUserName) {
          await prisma.telecaller.update({
            where: { id: existingT.id },
            data: {
              neodoveUserId: existingT.neodoveUserId || a.userId || null,
              neodoveUserName: existingT.neodoveUserName || a.userName || null,
            },
          });
        }
        continue;
      }
      maxOrder += 1;
      await prisma.telecaller.create({
        data: {
          name: a.userName,
          // New hires start as lead-gen only — they must be reviewed/flagged as
          // conversion specialists by MIS before receiving estimate follow-ups.
          assignEstimateFollowUps: false,
          order: maxOrder,
          neodoveUserId: a.userId || null,
          neodoveUserName: a.userName,
        },
      });
    }
    logger.info({ agents: agents.length, created: writesNeeded }, 'Synced telecallers from NeoDove');
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'syncTelecallersFromNeodove failed');
  }
}

export { syncTelecallersFromNeodove };

// ── Absentee cover (MIS) ─────────────────────────────────────────────────────
// When MIS marks an agent ABSENT, her entire open pipeline is dealt equally
// (round-robin by roster order) across the active conversion specialists as
// TEMP covers. The redistribution itself is never a snatch — no score event of
// any kind is written. Each cover ledger row carries `tempForTelecallerId` =
// the ABSENT agent's id (carried forward through later EOD re-poaches), so
// marking her PRESENT hands every still-open estimate straight back to her.
// A cover agent's conversions credit the LEAD GENERATOR (founder rule —
// recordConversionClose credits createdBy, holder only as fallback);
// converted/declined estimates do not come back. Locked and never-assign
// estimates are left untouched.
export async function markTelecallerAbsent(telecallerId: string): Promise<{ redistributed: number; covers: number }> {
  // ── Phase 1: parallel reads (3 independent D1 round-trips at once) ─────────
  const [tc, held, covers] = await Promise.all([
    prisma.telecaller.findUnique({ where: { id: telecallerId } }),
    prisma.estimate.findMany({
      // NOTE: temp-cover provenance (tempForTelecallerId) lives on the
      // EstimateAssignment ledger, NOT on Estimate — so it cannot be filtered
      // here (unknown column → SQL error). Nested-absence exclusion happens in
      // Phase 2 via the open ledger rows instead.
      where: { assignedTelecallerId: telecallerId, status: 'sent', skipAssignment: false, lockedTelecallerId: null },
      select: { estimateId: true, total: true },
    }),
    prisma.telecaller.findMany({
      where: { assignEstimateFollowUps: true, deleted: false, absentSince: null, id: { not: telecallerId } },
      orderBy: { order: 'asc' },
    }),
  ]);
  if (!tc) throw new Error('telecaller not found');
  if (held.length === 0 || covers.length === 0) {
    // Nothing to move (or nobody to cover) — still flag absent so the roster hides him.
    await prisma.telecaller.update({ where: { id: telecallerId }, data: { absentSince: new Date() } });
    logger.info({ telecallerId, name: tc.name, held: held.length, covers: covers.length }, 'Agent marked absent — nothing to redistribute');
    return { redistributed: 0, covers: covers.length };
  }

  // ── Phase 2: read the currently-open assignment rows (for the history chain) ─
  // One batched query resolves the previous holder for every held estimate.
  // Nested-absence guard lives here (not in Phase 1): an estimate whose open
  // ledger row is ALREADY a temp cover for another absent agent belongs to
  // someone else who's away and must NOT be swept into this redistribution —
  // otherwise two agents would both pull it back on return.
  const heldIds = held.map((e) => e.estimateId);
  // Chunked at IN_BATCH — D1 caps bound variables at 100/statement.
  const openRows: any[] = [];
  for (let i = 0; i < heldIds.length; i += IN_BATCH) {
    openRows.push(...await prisma.estimateAssignment.findMany({
      where: { estimateId: { in: heldIds.slice(i, i + IN_BATCH) }, status: 'assigned' },
      select: { id: true, estimateId: true, tempForTelecallerId: true },
    }));
  }
  const openByEstimate = new Map(openRows.map((r) => [r.estimateId, r.id]));
  const tempCovered = new Set(
    openRows.filter((r) => (r as any).tempForTelecallerId != null).map((r) => r.estimateId),
  );
  const movable = held.filter((e) => !tempCovered.has(e.estimateId));
  if (movable.length !== held.length) {
    logger.info(
      { telecallerId, held: held.length, movable: movable.length, skipped: held.length - movable.length },
      'markTelecallerAbsent: skipping estimates already temp-covering another absent agent',
    );
  }

  // ── Phase 3: build ALL writes, then fire them in chunks of D1 round-trips ─
  // Equal round-robin across the active conversion specialists (random start so it
  // isn't always the top of the roster). Batching collapses ~N×4 sequential
  // round-trips into a handful — this is what takes the call from ~10s to well
  // under 1s. Statements are chunked (D1 batch has practical size limits) and
  // each chunk is one network round-trip.
  const stmts: { sql: string; params: any[] }[] = [];
  const now = new Date();
  const nowIso = now.toISOString();
  const day = istDate();

  // (a) flag the agent absent
  stmts.push({ sql: 'UPDATE Telecaller SET absentSince = ? WHERE id = ?', params: [nowIso, telecallerId] });

  let idx = Math.floor(Math.random() * covers.length);
  for (const est of movable) {
    const cover = covers[idx % covers.length];
    const priorOpenId = openByEstimate.get(est.estimateId) ?? null;

    // (b) reassign the estimate to its cover
    stmts.push({ sql: 'UPDATE Estimate SET assignedTelecallerId = ? WHERE estimateId = ?', params: [cover.id, est.estimateId] });

    // (c) close the previous open assignment row (history chain)
    if (priorOpenId) {
      stmts.push({ sql: 'UPDATE EstimateAssignment SET status = ? WHERE id = ?', params: ['resolved', priorOpenId] });
    }

    // (d) open a new cover row, tagged with the absent agent so it returns on "present"
    stmts.push({
      sql: 'INSERT INTO EstimateAssignment (id, estimateId, telecallerId, assignedAt, day, reassignedFromId, status, snatchReason, tempForTelecallerId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      params: [crypto.randomUUID(), est.estimateId, cover.id, nowIso, day, priorOpenId, 'assigned', `Absent cover — ${tc.name} marked absent`, telecallerId],
    });

    idx += 1;
  }

  // Fire in chunks of 25 statements per D1 batch round-trip.
  const CHUNK = 25;
  try {
    for (let i = 0; i < stmts.length; i += CHUNK) {
      const chunk = stmts.slice(i, i + CHUNK);
      await (prisma as any).batch(chunk);
    }
  } catch (e: any) {
    logger.error(
      { telecallerId, error: e?.message || String(e), stmtCount: stmts.length, chunkSize: CHUNK, firstSql: stmts[0]?.sql },
      'markTelecallerAbsent: batched writes failed — falling back to sequential',
    );
    // Fallback: sequential writes so the feature still works while batching is debugged.
    await prisma.telecaller.update({ where: { id: telecallerId }, data: { absentSince: new Date() } });
    let fidx = Math.floor(Math.random() * covers.length);
    for (const est of movable) {
      const cover = covers[fidx % covers.length];
      await prisma.estimate.update({ where: { estimateId: est.estimateId }, data: { assignedTelecallerId: cover.id } });
      await recordAssignment(est.estimateId, cover.id, `Absent cover — ${tc.name} marked absent`, telecallerId);
      fidx += 1;
    }
  }

  logger.info(
    { telecallerId, name: tc.name, held: held.length, movable: movable.length, covers: covers.length, statements: stmts.length },
    'Agent marked absent — estimates redistributed (batched) as temp covers',
  );
  try { await invalidateRiskCache(); } catch { /* non-fatal */ }
  return { redistributed: movable.length, covers: covers.length };
}

export async function markTelecallerPresent(telecallerId: string): Promise<{ returned: number }> {
  // ── Phase 1: parallel reads ───────────────────────────────────────────────
  // Read the agent (for the history note) and all still-open temp-cover rows in one shot.
  const [tc, tempRows] = await Promise.all([
    prisma.telecaller.findUnique({ where: { id: telecallerId } }),
    prisma.estimateAssignment.findMany({
      where: { tempForTelecallerId: telecallerId, status: 'assigned' },
      orderBy: { assignedAt: 'asc' },
      select: { id: true, estimateId: true },
    }),
  ]);
  if (!tc) throw new Error('telecaller not found');

  // ── Phase 2: which of those are still open (not converted/declined while covered)?
  // One batched read over the candidate estimate ids.
  let returned = 0;
  if (tempRows.length > 0) {
    const estIds = tempRows.map((r) => r.estimateId);
    // Chunked at IN_BATCH — D1 caps bound variables at 100/statement.
    const estRows: any[] = [];
    for (let i = 0; i < estIds.length; i += IN_BATCH) {
      estRows.push(...await prisma.estimate.findMany({
        where: { estimateId: { in: estIds.slice(i, i + IN_BATCH) } },
        select: { estimateId: true, status: true },
      }));
    }
    const statusByEstimate = new Map(estRows.map((e) => [e.estimateId, e.status]));
    const openTempRows = tempRows.filter((r) => statusByEstimate.get(r.estimateId) === 'sent');

    if (openTempRows.length > 0) {
      // ── Phase 3: clear absent flag + return every open estimate, all batched ──
      const stmts: { sql: string; params: any[] }[] = [];
      const nowIso = new Date().toISOString();
      const day = istDate();

      // (a) clear the absent flag
      stmts.push({ sql: 'UPDATE Telecaller SET absentSince = ? WHERE id = ?', params: [null, telecallerId] });

      for (const row of openTempRows) {
        const priorOpenId = row.id; // the temp-cover row becomes the "reassigned from" link

        // (b) hand the estimate back to the original agent
        stmts.push({ sql: 'UPDATE Estimate SET assignedTelecallerId = ? WHERE estimateId = ?', params: [telecallerId, row.estimateId] });

        // (c) close the temp-cover row
        stmts.push({ sql: 'UPDATE EstimateAssignment SET status = ? WHERE id = ?', params: ['resolved', priorOpenId] });

        // (d) open a fresh row for the original agent (temp provenance cleared)
        stmts.push({
          sql: 'INSERT INTO EstimateAssignment (id, estimateId, telecallerId, assignedAt, day, reassignedFromId, status, snatchReason, tempForTelecallerId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          params: [crypto.randomUUID(), row.estimateId, telecallerId, nowIso, day, priorOpenId, 'assigned', `Returned from absence — back to ${tc.name}`, null],
        });
        returned += 1;
      }

      try {
        await (prisma as any).batch(stmts);
      } catch (e: any) {
        logger.error(
          { telecallerId, error: e?.message || String(e), stmtCount: stmts.length },
          'markTelecallerPresent: batch failed — falling back to sequential writes',
        );
        await prisma.telecaller.update({ where: { id: telecallerId }, data: { absentSince: null } });
        for (const row of openTempRows) {
          await prisma.estimate.update({ where: { estimateId: row.estimateId }, data: { assignedTelecallerId: telecallerId } });
          await recordAssignment(row.estimateId, telecallerId, `Returned from absence — back to ${tc.name}`, null);
        }
      }
    } else {
      // Temp rows exist but none are still open (all converted/declined while
      // covered) — nothing to return, but the agent is back: clear the flag
      // or they stay absent forever with no path forward.
      await prisma.telecaller.update({ where: { id: telecallerId }, data: { absentSince: null } });
    }
  } else {
    // No temp rows — just clear the flag.
    await prisma.telecaller.update({ where: { id: telecallerId }, data: { absentSince: null } });
  }

  logger.info({ telecallerId, name: tc.name, tempRows: tempRows.length, returned }, 'Agent marked present — temp-covered estimates returned (batched)');
  try { await invalidateRiskCache(); } catch { /* non-fatal */ }
  return { returned };
}
