// roster.ts — telecaller roster sync.
//
// Region model (founder, 2026-10-22): the MIS absent/present temp-cover flow,
// bulk deals and push-history writers are retired (estimates belong to regions
// now — staff hold/work estimates only in their own region; no individual
// assignment exists any more). Kept: the NeoDove-seeded roster sync; the
// live staff↔region roster is MIS-managed via the roster API
// (tlLevel + region fields on Telecaller).
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import type { Telecaller } from '@prisma/client';
import { mirrorRosterRow } from '../../modules/core/sync';
import { getAllNeodoveAgents } from '../neodove-telecaller-report';


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
    // Roster-name fallback (2026-11-02, Kamal case): a row created by MIS with
    // no NeoDove identity can never be adopted by the id/NeoDove-name match
    // above. Fall back to the ROSTER name (case-insensitive, trimmed) when it
    // identifies exactly one unlinked row — never when ambiguous.
    const byRosterName = new Map<string, (typeof existing)[number][]>();
    for (const t of existing) {
      if (t.neodoveUserId) byId.set(t.neodoveUserId, t);
      if (t.neodoveUserName) byName.set(t.neodoveUserName, t);
      const norm = String(t.name ?? '').toLowerCase().trim();
      if (!norm) continue;
      const list = byRosterName.get(norm) ?? [];
      list.push(t);
      byRosterName.set(norm, list);
    }

    const matchExisting = (a: { userId?: string | null; userName?: string | null }) => {
      // Links are sales-head set on the roster row (NeoDove user picker in the
      // Controller); auto-sync only fills empty link fields below and never
      // overwrites a hand-picked link.
      // NeoDove userIds are RECYCLED across staff (2026-11-02: 3518625a stored
      // on Muskan's row, reported as Kamal; 13889a99 on Deepak + Piyush rows,
      // reported as Piyush). A userId hit against a DIFFERENT stored userName
      // is a stale claim, never an adoption — the human-readable userName is
      // the stable key, so it matches first and a conflicting userId is
      // skipped (the stale row keeps its id but becomes inert: the userId
      // fallback below only serves rows with no userName at all).
      if (a.userName) {
        const byNameHit = byName.get(a.userName);
        if (byNameHit) return byNameHit;
      }
      if (a.userId) {
        const byIdHit = byId.get(a.userId);
        if (byIdHit) {
          const storedName = String(byIdHit.neodoveUserName ?? '');
          if (!storedName || (a.userName && storedName === a.userName)) return byIdHit;
        }
      }
      const norm = String(a.userName ?? '').toLowerCase().trim();
      if (!norm) return undefined;
      const candidates = (byRosterName.get(norm) ?? []).filter(
        (t) => !t.neodoveUserId && !t.neodoveUserName,
      );
      return candidates.length === 1 ? candidates[0] : undefined;
    };

    let writesNeeded = 0;
    for (const a of agents) {
      const existingT = matchExisting(a);
      if (existingT) {
        if (!existingT.neodoveUserId || !existingT.neodoveUserName) writesNeeded++;
      } else {
        writesNeeded++;
      }
    }
    if (writesNeeded === 0) return; // already fully synced

    let maxOrder = existing.reduce((m, t) => Math.max(m, t.order ?? 0), 0);
    for (const a of agents) {
      const existingT = matchExisting(a);
      if (existingT) {
        if (!existingT.neodoveUserId || !existingT.neodoveUserName) {
          await prisma.telecaller.update({
            where: { id: existingT.id },
            data: {
              neodoveUserId: existingT.neodoveUserId || a.userId || null,
              neodoveUserName: existingT.neodoveUserName || a.userName || null,
            },
          });
          // Operational link fill only — never overwrites a hand link (guarded
          // by the empty-check above). Mirrored straight into core (no confirm).
          await mirrorRosterRow('telecaller', existingT.id);
        }
        continue;
      }
      maxOrder += 1;
      // Recycled-id tripwire: this agent's userId is still parked on a row
      // with a different userName (a predecessor). Creating the new row is
      // correct — the stale row is inert (userId fallback only serves rows
      // with no userName) — but MIS should see it in the logs.
      const clash = a.userId ? byId.get(a.userId) : undefined;
      if (clash && String(clash.neodoveUserName ?? '') && String(clash.neodoveUserName) !== a.userName) {
        logger.warn(
          { userId: a.userId, staleName: clash.neodoveUserName, newName: a.userName },
          'NeoDove userId recycled across staff — new roster row created, stale row left untouched',
        );
      }
      const created = await prisma.telecaller.create({
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
      await mirrorRosterRow('telecaller', created);
    }
    logger.info({ agents: agents.length, created: writesNeeded }, 'Synced telecallers from NeoDove');
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'syncTelecallersFromNeodove failed');
  }
}

export { syncTelecallersFromNeodove };
