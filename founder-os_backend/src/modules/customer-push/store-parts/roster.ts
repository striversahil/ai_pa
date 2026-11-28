// roster.ts — who a push can target: the region's telecallers and every Team
// Lead, read from the live sales view over HumanResourcesMember (mig 0177).
// One person = one row; there is no second roster table.
import type { CampaignAgent } from '../types';
import { pushDb } from './db';
import { tlRegions } from '../../../automations/telecalling/regions';

type DialerAgent = CampaignAgent & { covers?: string[] };

/** Ids with an active paired phone (the dialer's device registration). */
async function pairedAgents(db: any): Promise<Set<string>> {
  const res = await db.prepare(`SELECT DISTINCT telecallerId FROM DeviceRegistration WHERE status = 'active'`).all().catch(() => null);
  return new Set(((res?.results ?? []) as any[]).map((r) => String(r.telecallerId)));
}

function toAgent(row: any, region: string, paired: Set<string>): DialerAgent {
  const id = String(row?.id ?? '');
  return {
    key: id,
    region,
    name: String(row?.name ?? ''),
    active: true,
    // Leads wait in the queue until a phone is paired, so an unpaired agent
    // is still a valid destination — `source` tells the UI which is which.
    configured: true,
    source: paired.has(id) ? 'device' : 'none',
  };
}

/** Region roster telecallers, sorted by id so the split buckets stay stable. */
export async function listDialerAgents(region: string): Promise<DialerAgent[]> {
  const db = pushDb();
  if (!db) return [];
  const [res, paired] = await Promise.all([
    db.prepare(
      `SELECT id, name FROM Telecaller
        WHERE region = ? AND (type IS NULL OR type = '' OR type = 'telecaller') AND (deleted IS NULL OR deleted = 0)
        ORDER BY id`,
    ).bind(region).all().catch(() => null),
    pairedAgents(db),
  ]);
  return ((res?.results ?? []) as any[]).map((r) => toAgent(r, region, paired));
}

/** Every roster Team Lead (`covers` hints which regions they answer for). */
export async function listDialerTeamLeads(): Promise<DialerAgent[]> {
  const db = pushDb();
  if (!db) return [];
  const [res, paired] = await Promise.all([
    db.prepare(`SELECT id, name, region, regions FROM Telecaller WHERE type = 'team_lead' AND (deleted IS NULL OR deleted = 0) ORDER BY id`).all().catch(() => null),
    pairedAgents(db),
  ]);
  return ((res?.results ?? []) as any[]).map((r) => ({
    ...toAgent(r, String(r.region ?? ''), paired),
    covers: tlRegions({ region: r.region, regions: r.regions }),
  }));
}
