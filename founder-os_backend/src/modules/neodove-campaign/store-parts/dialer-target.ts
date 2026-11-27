// Push target 'dialer': roster reads + ledger marks for Founder OS dialer
// pushes. The NeoDove ledger (NeoDovePushBatch / NeoDoveLeadPush) stays the
// single history for both targets; the queue itself lives in modules/dialer.
import type { CampaignAgent } from "../types";
import { campaignDb } from "./io";
import { tlRegions } from "../../../automations/telecalling/regions";

type DialerAgent = CampaignAgent & { secretName: string; campaignUrl: string; kind: string };

function toAgent(row: any, kind: string, region: string, paired: Set<string>): DialerAgent {
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
    secretName: '',
    campaignUrl: '',
    kind,
  };
}

async function pairedAgents(db: any): Promise<Set<string>> {
  const res = await db.prepare(`SELECT DISTINCT telecallerId FROM DeviceRegistration WHERE status = 'active'`).all().catch(() => null);
  return new Set(((res?.results ?? []) as any[]).map((r) => String(r.telecallerId)));
}

/** Region roster telecallers (the dialer's "pair"), sorted by id for stable split buckets. */
export async function listDialerAgents(region: string): Promise<DialerAgent[]> {
  const db = campaignDb();
  if (!db) return [];
  const [res, paired] = await Promise.all([
    db.prepare(
      `SELECT id, name FROM Telecaller
        WHERE region = ? AND (type IS NULL OR type = '' OR type = 'telecaller') AND (deleted IS NULL OR deleted = 0)
        ORDER BY id`,
    ).bind(region).all(),
    pairedAgents(db),
  ]);
  return ((res?.results ?? []) as any[]).map((r) => toAgent(r, 'agent', region, paired));
}

/** Every roster Team Lead (single full-copy pushes only, like NeoDove TLs). */
export async function listDialerTeamLeads(): Promise<Array<DialerAgent & { covers: string[] }>> {
  const db = campaignDb();
  if (!db) return [];
  const [res, paired] = await Promise.all([
    db.prepare(`SELECT id, name, region, regions FROM Telecaller WHERE type = 'team_lead' AND (deleted IS NULL OR deleted = 0) ORDER BY id`).all(),
    pairedAgents(db),
  ]);
  return ((res?.results ?? []) as any[]).map((r) => ({
    ...toAgent(r, 'team_lead', String(r.region ?? ''), paired),
    covers: tlRegions({ region: r.region, regions: r.regions }),
  }));
}

/** Ledger rows a dialer push skipped because the number already waits in that agent's queue. */
export async function markSkippedLeads(ids: string[], reason: string): Promise<void> {
  const db = campaignDb();
  if (!db || ids.length === 0) return;
  for (let i = 0; i < ids.length; i += 50) {
    const slice = ids.slice(i, i + 50);
    await db.prepare(
      `UPDATE NeoDoveLeadPush SET status = 'skipped', skipReason = ? WHERE id IN (${slice.map(() => '?').join(',')})`,
    ).bind(reason, ...slice).run();
  }
}
