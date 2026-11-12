// Extracted verbatim from service.ts by scripts/refactor/split-module.mjs.
// service.ts re-exports everything public here, so existing imports keep working.
import { prisma } from "../../../shared/prisma";
import { logger } from "../../../shared/logger";
import { getEpochDate, closePointsFor, getConvertersMap, EPOCH_SETTING_KEY } from "../scoring";
import { loadCreatorIndex, loadAcceptedSnapshot, groupAcceptedByWeek, groupAcceptedByWeekFiltered, roundAgg } from "../accepted";
import type { AcceptedSnapshot, AcceptedAgg, AcceptedEstimate } from "../accepted";
import { getNeodoveAgentMap, getNeodoveRangeMap, CONNECTED_CALLS_PER_DAY, LEADS_PER_AGENT_PER_DAY } from "../../neodove-telecaller-report";
import type { AutomationContext } from "../../../modules/automation/types";
import { DATE_RE, istDate, IN_BATCH } from "../util";
import { cached } from "../../../shared/cache";
import { overlayCallTags, overlayNextSteps } from "../call-tags";
import { syncTelecallersFromNeodove } from "../roster";
import { isValidRegion, REGIONS, tlRegions, DAILY_TL_RESELLER_TARGET, TL_LEVELS } from "../regions";
import type { TlLevel, RegionId } from "../regions";
import { loadDeclinedSnapshot } from "../declined";
import type { DeclinedEstimate, DeclinedAgg } from "../declined";
import { classifyClients, normalizeClientKey } from "../client-segments";
import type { ClientSegmentKind } from "../client-segments";
import { getRiskItems, parseCommentDateMs, buildSnatchReason } from "../risk";
import { DEFAULT_TARGET_START, TARGET_START_KEY, weekStartOf, buildRegionTargets, workingDaysBetweenExcluding, DAILY_REGION_TARGET, isSunday } from "../targets";
import type { RegionTarget } from "../targets";
import { isSystemGeneratedComment } from "../../../shared/systemComment";
import { istDayOf, UNATTRIBUTED_LEADS_KEY, listDays, UNATTRIBUTED_CLOSE_KEY, weekdayOf, periodRange, periodPrefix, RISK_LIST_CAP } from "./pure";
import type { TelecallingDailyRow, SalesHoliday } from "./types";

export async function getEnquiryLeadCounts(from: string, to: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    // Unfiltered read + JS-side IST-day gate (portable across D1/Postgres
    // date storage; the Enquiry table is small).
    const rows = await prisma.enquiry.findMany({
      select: { assignedAgentId: true, createdAt: true },
    });
    for (const r of (rows as any[]) ?? []) {
      const d = istDayOf(r?.createdAt);
      if (!d || d < from || d > to) continue;
      const agent = String(r?.assignedAgentId ?? '').trim();
      const k = agent ? `${d}|${agent}` : UNATTRIBUTED_LEADS_KEY;
      out.set(k, (out.get(k) ?? 0) + 1);
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'enquiry lead counts read failed — leads show 0');
  }
  return out;
}

/**
 * Per-day × per-staff MIS breakdown for an inclusive IST range (region
 * model). Sources per day: close-credit events split 20/80 across
 * generator/closer rows (+ legacy full-slab rows), accepted estimate values,
 * enquiry-sourced leads and the stored NeoDove day snapshot. Gated by the
 * history epoch (getEpochDate) — pre-epoch rows never count.
 */
export async function computeTelecallingDaily(
  from: string,
  to: string,
): Promise<{ rows: TelecallingDailyRow[] } | { error: string }> {
  const dates = listDays(from, to);
  if (dates === null) return { error: 'daily breakdown capped at 93 days — pick week/month, not year' };
  if (dates.length === 0) return { rows: [] };
  const epoch = await getEpochDate();
  const fromEff = epoch && epoch > from ? epoch : from;
  if (fromEff > to) return { rows: [] };
  const telecallers = await prisma.telecaller.findMany({ where: { deleted: false }, orderBy: { order: 'asc' } });
  const nameById = new Map(telecallers.map((t) => [t.id, t.name]));

  type DayAgg = { won: number; closePoints: number; estIds: string[]; value: number };
  const agg = new Map<string, DayAgg>(); // `${day}|${owner}`
  const cell = (day: string, owner: string): DayAgg => {
    const k = `${day}|${owner}`;
    let c = agg.get(k);
    if (!c) { c = { won: 0, closePoints: 0, estIds: [], value: 0 }; agg.set(k, c); }
    return c;
  };

  // Wins/₹ from accepted estimates on their acceptedAt day — the SAME source
  // as the dashboard (accepted.ts). Reading the close ledger here used to make
  // the MIS export under-report exactly like the board did.
  try {
    const rows = (await prisma.estimate.findMany({
      where: {
        status: { in: ['accepted', 'confirmed'] },
        OR: [
          { acceptedAt: { gte: fromEff, lte: to } },
          { acceptedAt: null, date: { gte: fromEff, lte: to } },
        ],
      },
      select: { estimateId: true, estimateNumber: true, total: true, createdBy: true, acceptedAt: true, date: true },
    })) as any[];
    for (const r of rows) {
      const day = String(r.acceptedAt ?? r.date ?? '').slice(0, 10);
      if (!day || day < fromEff || day > to) continue;
      // Unattributed closes stay visible under a sentinel row instead of
      // vanishing (same principle as UNATTRIBUTED_LEADS_KEY).
      const owner = String(r.createdBy ?? '').trim() || UNATTRIBUTED_CLOSE_KEY;
      const c = cell(day, owner);
      c.won += 1;
      c.closePoints += closePointsFor(r.total);
      c.value += Number(r.total ?? 0) || 0;
      c.estIds.push(String(r.estimateNumber ?? r.estimateId ?? ''));
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'daily: accepted-estimate read failed');
  }

  // Owner list = active roster (so zero-days still render) + any creator who
  // closed in the window but is no longer active (Sales Head / departed staff).
  type Owner = { id: string; name: string; region: string; neodoveUserName?: string | null; neodoveUserId?: string | null };
  const owners: Owner[] = (telecallers as any[]).map((t) => ({
    id: String(t.id),
    name: String(t.name ?? ''),
    region: String((t as any).region ?? ''),
    neodoveUserName: (t as any).neodoveUserName,
    neodoveUserId: (t as any).neodoveUserId,
  }));
  const knownOwners = new Set(owners.map((o) => o.id));
  if ([...agg.keys()].some((k) => !knownOwners.has(k.slice(k.indexOf('|') + 1)))) {
    const creatorIndex = await loadCreatorIndex();
    for (const key of agg.keys()) {
      const ownerId = key.slice(key.indexOf('|') + 1);
      if (!ownerId || knownOwners.has(ownerId)) continue;
      knownOwners.add(ownerId);
      owners.push({
        id: ownerId,
        name: ownerId === UNATTRIBUTED_CLOSE_KEY
          ? 'Unlinked close (no creator)'
          : creatorIndex.nameById.get(ownerId) ?? ownerId,
        region: ownerId === UNATTRIBUTED_CLOSE_KEY ? '' : creatorIndex.regionById.get(ownerId) ?? '',
      });
    }
  }

  // NeoDove snapshots, one cached read per day.
  const neoByDay = new Map<string, Record<string, any>>();
  for (const d of dates) {
    try {
      neoByDay.set(d, await getNeodoveAgentMap(d));
    } catch {
      neoByDay.set(d, {});
    }
  }

  const out: TelecallingDailyRow[] = [];
  // Enquiry-sourced leads (replaces NeoDove get-leads): one count map for the
  // whole range, looked up per (day, agent) cell below.
  const enquiryLeadsDaily = await getEnquiryLeadCounts(from, to).catch(() => new Map<string, number>());
  // Connected-call source: neodove | manual | device (Setting `call_source`).
  let manualByDay = new Map<string, Record<string, unknown>>();
  let deviceByDay = new Map<string, { attempted: number; connected: number; notConnected: number; talkSec: number }>();
  let callSource: 'neodove' | 'manual' | 'device' = 'neodove';
  try {
    const { getCallSource } = await import('../call-source');
    callSource = await getCallSource();
    if (callSource === 'manual') {
      const { listManualCallRows } = await import('../manual-calls');
      const rows = await listManualCallRows(from, to);
      for (const r of rows as any[]) {
        const k = `${String(r.day ?? '')}|${String(r.telecallerId ?? '')}`;
        manualByDay.set(k, r as Record<string, unknown>);
      }
    } else if (callSource === 'device') {
      const { getDeviceCallSums } = await import('../device-calls');
      deviceByDay = await getDeviceCallSums(from, to);
    }
  } catch { /* pre-migration → NeoDove as before */ }
  for (const d of dates) {
    const neoMap = neoByDay.get(d) ?? {};
    for (const o of owners) {
      const id = o.id;
      const c = agg.get(`${d}|${id}`);
      const nd = (o.neodoveUserName && neoMap[o.neodoveUserName])
        // userId fallback only when the row holds no userName (recycled ids
        // must never credit a stranger's calls — see the ndByTc note above).
        || (!o.neodoveUserName && o.neodoveUserId && neoMap[o.neodoveUserId])
        || undefined;
      const manualRow = manualByDay.get(`${d}|${id}`);
      const deviceRow = deviceByDay.get(`${d}|${id}`);
      const callsConnected = deviceRow
        ? deviceRow.connected
        : manualRow ? Number((manualRow as any).connectedCalls ?? 0) || 0 : nd?.callsConnected ?? 0;
      // Enquiry-sourced (Sales Enquiries dashboard) — not NeoDove get-leads.
      const leadsGenerated = enquiryLeadsDaily.get(`${d}|${id}`) ?? 0;
      out.push({
        date: d,
        weekday: weekdayOf(d),
        telecallerId: id,
        telecallerName: o.name,
        region: o.region,
        won: c?.won ?? 0,
        closedValue: Math.round(c?.value ?? 0),
        closedEstimates: (c?.estIds ?? []).join(' | '),
        callsAttempted: deviceRow ? deviceRow.attempted : manualRow ? callsConnected : nd?.callsAttempted ?? 0,
        callsConnected,
        callsNotConnected: deviceRow ? deviceRow.notConnected : manualRow ? 0 : nd?.callsNotConnected ?? 0,
        talkTimeMin: deviceRow ? Math.round(deviceRow.talkSec / 60) : Math.round((nd?.talkTimeSec ?? 0) / 60),
        leadsGenerated,
        leadsConverted: nd?.leadsConverted ?? 0,
        score: (c?.closePoints ?? 0) + leadsGenerated * 15 + Math.round(callsConnected * 0.5),
      });
    }
  }
  return { rows: out };
}

export async function getTelecallingDashboardData(ctx?: AutomationContext): Promise<any> {
  const q = (ctx?.subject ?? {}) as Record<string, unknown>;
  // 5-min TTL (not 30s): every write path invalidates these keys explicitly
  // (invalidateRiskCache / estimates-cache / neodove report), and live events
  // refetch — so the TTL only governs idle re-reads. A short TTL meant every
  // filter click + every 30s of idle viewing re-ran the full aggregation, and
  // a page load's ~10 concurrent cold computes contended into 30s+ timeouts
  // (2026-09-08 filter incident).
  const DASH_TTL_MS = 5 * 60 * 1000;
  // Converters-only shortcut for the per-estimate export
  // (GET /api/automations/telecalling/data?converters=1&since=YYYY-MM-DD):
  // returns just { converters } from the close ledger and skips the full
  // dashboard aggregation entirely. Same endpoint on both runtimes, no new
  // route needed.
  const wantConverters = String(q.converters ?? '') === '1' || String(q.converters ?? '').toLowerCase() === 'true';
  if (wantConverters) {
    const since = typeof q.since === 'string' && DATE_RE.test(q.since) ? q.since : '';
    return cached<any>(`telecalling:converters:${since || 'all'}`, DASH_TTL_MS, () => getConvertersMap(since));
  }
  const requestedDay = typeof q.date === 'string' && DATE_RE.test(q.date) ? q.date : istDate();
  const period = typeof q.period === 'string' && q.period ? q.period : 'today';
  const agent = typeof q.agent === 'string' && q.agent ? q.agent : '';
  const selfAgentId = typeof q.selfAgentId === 'string' && q.selfAgentId ? q.selfAgentId : '';
  // Include selfAgentId so a scoped staff member never receives a cached
  // team-wide (managed) payload — each user's view is isolated in the cache.
  const wantDaily = String(q.daily ?? '') === '1' || String(q.daily ?? '').toLowerCase() === 'true';
  // Region drills carry their own followUps, so they MUST NOT share a cache
  // entry with the unfiltered dashboard: whichever request populated the key
  // used to win, and a dashboard-first load cached a payload with no
  // followUps → every region tab rendered an empty Lead Conversion list.
  const regionKey = typeof q.region === 'string' ? q.region.trim().toLowerCase() : '';
  const cacheKey = `telecalling:dashboard:${period}:${requestedDay}:${agent}:${selfAgentId}:${wantDaily ? 'daily' : ''}:${regionKey}`;
  const payload = await cached<any>(cacheKey, DASH_TTL_MS, async () => {
    return computeTelecallingDashboardData(ctx);
  });
  // Agent call tags ride OUTSIDE the 5-min cache (see overlayCallTags): a tag
  // tap is a single-row write with zero invalidation, and this merge makes it
  // visible on the very next read — millisecond-grade propagation without the
  // multi-second full-aggregation recompute a cache bust would force.
  try {
    const rows: any[] = Array.isArray((payload as any)?.followUps) ? (payload as any).followUps : [];
    if (rows.length > 0) {
      await overlayCallTags(rows);
      await overlayNextSteps(rows);
    }
  } catch { /* overlay best-effort; cached rows render as-is */ }
  return payload;
}

/**
 * The actual (expensive) aggregation. Exposed for reuse and clarity; the public
 * `getTelecallingDashboardData` wraps this in the KV cache.
 */
export async function computeTelecallingDashboardData(ctx?: AutomationContext): Promise<any> {
  const q = (ctx?.subject ?? {}) as Record<string, unknown>;
  const requestedDay = (typeof q.date === 'string' && DATE_RE.test(q.date) ? q.date : istDate());
  const periodRangeInfo = periodRange(typeof q.period === 'string' ? q.period : 'today', istDate());
  const periodMode = periodRangeInfo !== null;

  // Auto-sync the Telecaller roster from the unique NeoDove agents (all stored
  // days). Idempotent — no-op once every agent is already present.
  await syncTelecallersFromNeodove();

  // Always use the requested day/range. Never substitute an older NeoDove
  // snapshot: doing that mixed yesterday's calls with today's enquiry leads
  // (and mislabeled stale data as "Today"). If today's push is empty, calls
  // legitimately read 0 until the next sync — leads stay live from enquiries.
  const day = requestedDay;
  let neodoveMap: Record<string, any> = {};
  if (periodMode && periodRangeInfo) {
    // Period leaderboard: sum the stored daily NeoDove reports across the range.
    neodoveMap = await getNeodoveRangeMap(periodRangeInfo.from, periodRangeInfo.to);
  } else {
    neodoveMap = await getNeodoveAgentMap(requestedDay);
  }

  const telecallers = await prisma.telecaller.findMany({ where: { deleted: false }, orderBy: { order: 'asc' } });
  const nameById = new Map(telecallers.map((t) => [t.id, t.name]));
  const regionByTc = new Map<string, string>();
  const tlLevelByTc = new Map<string, TlLevel>();
  for (const t of telecallers as any[]) {
    regionByTc.set(String(t.id), String((t as any).region ?? ''));
    tlLevelByTc.set(String(t.id), ((t as any).tlLevel ?? '') as TlLevel);
  }

  // History epoch — every close-ledger read starts at max(periodFrom, epoch).
  const epoch = await getEpochDate();

  // Lead Generation: drilled call KPis per staff member from the NeoDove map.
  // The userId fallback serves ONLY rows with no stored userName: NeoDove ids
  // are recycled across staff, so a stored userName that misses the map means
  // "this person has no report" — falling back to their (possibly reassigned)
  // id would credit them a stranger's calls (2026-11-02: Muskan's stale
  // 3518625a would have read Kamal's calls).
  // Links are sales-head set on the roster row (NeoDove user picker);
  // auto-sync only fills empty link fields and never overwrites a hand link.
  const ndByTc = new Map<string, Record<string, number>>();
  for (const t of telecallers as any[]) {
    const nd = (t.neodoveUserName && neodoveMap[t.neodoveUserName])
      || (!t.neodoveUserName && t.neodoveUserId && neodoveMap[t.neodoveUserId])
      || null;
    ndByTc.set(String(t.id), nd ?? {});
  }

  // TEMPORARY manual-call override (founder 2026-11-04): while Setting
  // `manual_calls_mode` = 'manual', connected calls come from the hand-counted
  // ManualCallLog rows (screenshot proof) instead of NeoDove. Attempted is set
  // = connected (no attempted split is collected manually); talk/other NeoDove
  // fields ride through unchanged.
  let callsSource: 'manual' | 'neodove' | 'device' = 'neodove';
  try {
    const { getCallSource } = await import('../call-source');
    callsSource = await getCallSource();
    const leadFrom0 = periodMode && periodRangeInfo ? periodRangeInfo.from : day;
    const leadTo0 = periodMode && periodRangeInfo ? periodRangeInfo.to : day;
    if (callsSource === 'manual') {
      const { getManualCallsSum } = await import('../manual-calls');
      const manualSum = await getManualCallsSum(leadFrom0, leadTo0);
      for (const t of telecallers as any[]) {
        const id = String((t as any).id ?? '');
        const m = manualSum.get(id) ?? 0;
        const prev = ndByTc.get(id) ?? {};
        ndByTc.set(id, { ...prev, callsConnected: m, callsAttempted: m, callsNotConnected: 0 });
      }
    } else if (callsSource === 'device') {
      const { getDeviceCallSums } = await import('../device-calls');
      const sums = await getDeviceCallSums(leadFrom0, leadTo0);
      const perAgent = new Map<string, { attempted: number; connected: number; notConnected: number; talkSec: number }>();
      for (const [key, value] of sums) {
        const id = key.slice(key.indexOf('|') + 1);
        const cur = perAgent.get(id) ?? { attempted: 0, connected: 0, notConnected: 0, talkSec: 0 };
        cur.attempted += value.attempted;
        cur.connected += value.connected;
        cur.notConnected += value.notConnected;
        cur.talkSec += value.talkSec;
        perAgent.set(id, cur);
      }
      for (const t of telecallers as any[]) {
        const id = String((t as any).id ?? '');
        const d = perAgent.get(id);
        if (!d) continue;
        const prev = ndByTc.get(id) ?? {};
        ndByTc.set(id, {
          ...prev,
          callsAttempted: d.attempted,
          callsConnected: d.connected,
          callsNotConnected: d.notConnected,
          talkTimeSec: d.talkSec,
        });
      }
    }
  } catch { /* call_source unavailable (pre-migration) → NeoDove as before */ }

  // Enquiry-sourced leads (Sales Enquiries dashboard — replaces NeoDove
  // get-leads): per-agent enquiry-creation totals over the leaderboard window.
  // The UNATTRIBUTED_LEADS_KEY sentinel is peeled off into unattributedLeads
  // (meta) — never attributed to an agent id of ''.
  const leadFrom = periodMode && periodRangeInfo ? periodRangeInfo.from : day;
  const leadTo = periodMode && periodRangeInfo ? periodRangeInfo.to : day;
  const leadsByAgent = new Map<string, number>();
  let unattributedLeads = 0;
  try {
    const enquiryLeads = await getEnquiryLeadCounts(leadFrom, leadTo);
    for (const [k, n] of enquiryLeads) {
      if (k === UNATTRIBUTED_LEADS_KEY) { unattributedLeads += n; continue; }
      const agent = k.slice(k.indexOf('|') + 1);
      leadsByAgent.set(agent, (leadsByAgent.get(agent) ?? 0) + n);
    }
  } catch { /* getEnquiryLeadCounts already warns — leads default 0 */ }

  // ── Accepted wins (single source of truth) ────────────────────────────────
  // Wins/₹/points come from ACCEPTED ESTIMATES on their acceptedAt day, NOT
  // from the close-event ledger: a ledger row that never got written used to
  // hide a real sale (22 of them in October 2026, ₹10.9L), and the ledger's
  // day can disagree with the estimate's own month. The epoch still gates the
  // window — a founder-approved reset means "start counting from that day".
  const wonFrom = epoch && epoch > leadFrom ? epoch : leadFrom;
  const wonTo = periodMode && periodRangeInfo ? periodRangeInfo.to : leadTo;
  const creatorIndex = await loadCreatorIndex();
  const wonSnapshot: AcceptedSnapshot = await loadAcceptedSnapshot(wonFrom, wonTo, { creatorIndex });
  // Declines use the PERIOD window (never the points epoch — a history reset
  // only forgets credits, not what the team lost). Same creator index, same
  // region attribution rule as wins (declined.ts).
  const declinedSnapshot = await loadDeclinedSnapshot(leadFrom, wonTo, { creatorIndex });

  // ── Consumer vs reseller (founder 2026-11-02: the ₹1L/day target counts
  //  END-CONSUMER accepted ₹ only). Every accepted/declined row in the window
  //  is classified: manual override → auto master match → unset (needs
  //  review). Unset + reseller rows are EXCLUDED from target achievement but
  //  stay in Won (bifurcated) so money never silently disappears.
  const declinedNames: string[] = [];
  for (const list of declinedSnapshot.byRegionItems.values()) {
    for (const r of list as DeclinedEstimate[]) declinedNames.push(String(r?.customerName ?? ''));
  }
  const segmentByKey = await classifyClients([
    ...wonSnapshot.rows.map((r) => String(r?.customerName ?? '')),
    ...declinedNames,
  ]);
  const segOf = (customerName: unknown): { segment: ClientSegmentKind; source: string } => {
    const cls = segmentByKey.get(normalizeClientKey(customerName));
    if (!cls) return { segment: '', source: 'none' };
    return { segment: cls.segment, source: cls.source };
  };

  // Historic penalties (−10 remark / −15 snatch) are the only ledger rows that
  // still move a staff score; positive close rows no longer define wins.
  const penaltiesByTc = new Map<string, number>();
  try {
    const events = await prisma.telecallerScoreEvent.findMany({
      where: { day: { gte: wonFrom, lte: wonTo }, delta: { lt: 0 } },
      select: { telecallerId: true, delta: true },
    });
    for (const ev of events as any[]) {
      const id = String(ev.telecallerId);
      penaltiesByTc.set(id, (penaltiesByTc.get(id) ?? 0) + (Number(ev.delta) || 0));
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'legacy penalty read failed — scores ignore historic penalties');
  }

  // Live pipeline risk over the open `sent` estimates — served from the 15-min
  // cache (D1 row-read budget protection). Informational only.
  const nowMs = Date.now();
  const riskItems = await getRiskItems();

  // ── Open `sent` pipeline per REGION (the ownership model) ──────────────────
  const sentOpen = await prisma.estimate.findMany({
    where: { status: 'sent' },
    select: { estimateId: true, estimateNumber: true, customerName: true, total: true, region: true, organizationId: true, createdBy: true, lastSyncTime: true },
  });
  const openByRegion = new Map<string, { count: number; value: number }>();
  for (const e of sentOpen as any[]) {
    const region = String(e.region ?? '');
    const cur = openByRegion.get(region) ?? { count: 0, value: 0 };
    cur.count += 1;
    cur.value += Number(e.total ?? 0) || 0;
    openByRegion.set(region, cur);
  }

  // ── Unmapped estimates (region '') across ALL live statuses ────────────────
  // Founder rule (2026-11-01): an estimate with no region shows in the Unmapped
  // queue even when it is already accepted or declined — region ownership
  // applies regardless of status, and a no-region accepted row earns nothing
  // until it is linked. Kept separate from the `sent`-only openByRegion above
  // so region pipeline cards don't change shape.
  const unmappedRows = await prisma.estimate.findMany({
    where: { region: '', status: { in: ['sent', 'accepted', 'confirmed', 'declined'] } },
    select: { estimateId: true, estimateNumber: true, customerName: true, total: true, status: true, organizationId: true, createdBy: true, lastSyncTime: true },
    orderBy: { lastSyncTime: 'desc' },
  });
  const unmappedSent: Array<Record<string, unknown>> = [];
  for (const e of (unmappedRows as any[]).slice(0, 50)) {
    unmappedSent.push({
      estimateId: e.estimateId,
      estimateNumber: e.estimateNumber,
      customerName: e.customerName,
      total: Number(e.total ?? 0) || 0,
      status: String(e.status ?? ''),
      generatedBy: e.createdBy ? nameById.get(String(e.createdBy)) ?? null : null,
      organizationId: String(e.organizationId ?? ''),
      lastSync: e.lastSyncTime ?? null,
    });
  }
  const unmappedCount = (unmappedRows as any[]).length;
  const unmappedValue = (unmappedRows as any[]).reduce((s: number, e: any) => s + (Number(e.total ?? 0) || 0), 0);

  // ── Region targets + weekly carry-forward ─────────────────────────────────
  // Every region owes ₹1L of accepted value per working day; a week's shortfall
  // carries into the next week. Computed over the ledger window, INDEPENDENT of
  // the selected period filter — "where does my team stand" must not change
  // depending on which tab you are looking at. Start day is a Setting (founder
  // decision: retroactive from 2026-10-01).
  //
  // National holidays (SalesHoliday table, sales-head marked) accrue ₹0 like
  // Sundays, so they shrink the week's target and the carry-out deficit. The
  // ledger recomputes from the start on every call, so backdated holidays
  // retroactively reduce old dues by design.
  let targetStart = DEFAULT_TARGET_START;
  try {
    const row: any = await prisma.setting.findUnique({ where: { key: TARGET_START_KEY } });
    const v = String(row?.value ?? '').trim();
    if (DATE_RE.test(v)) targetStart = v;
  } catch { /* fall back to the default start */ }
  let holidays = new Set<string>();
  try {
    const rows: any[] = await (prisma as any).salesHoliday.findMany({ orderBy: { day: 'asc' } });
    for (const r of rows ?? []) {
      const day = String((r as any)?.day ?? '').trim();
      if (DATE_RE.test(day)) holidays.add(day);
    }
  } catch { /* fresh DB without the table — behave as no holidays */ }
  const todayDay = istDate();
  // Reuse the wins snapshot when it already spans the whole ledger window.
  const targetSnapshot = wonFrom <= targetStart && todayDay <= wonTo
    ? wonSnapshot
    : await loadAcceptedSnapshot(targetStart, todayDay, { creatorIndex });
  // The ledger window can hold customer names the period classify never saw —
  // merge them so segOf/regionOf cover every ledger row (else older-week
  // reseller rows silently miss the TL ledger).
  try {
    const seen = new Set<string>();
    for (const k of segmentByKey.keys()) seen.add(k);
    const missingNames: string[] = [];
    const missingKeys = new Set<string>();
    for (const r of targetSnapshot.rows as any[]) {
      const k = normalizeClientKey((r as any)?.customerName);
      if (!k || seen.has(k) || missingKeys.has(k)) continue;
      missingKeys.add(k);
      missingNames.push(String((r as any)?.customerName ?? ''));
    }
    if (missingNames.length > 0) {
      const extra = await classifyClients(missingNames);
      for (const [k, v] of extra) segmentByKey.set(k, v);
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'tl ledger classify merge failed — older weeks may undercount');
  }
  // Sales-head direct re-homing (founder 2026-11-05): a direct row (HQ close,
  // no Estimate.region) is resolved through the Customer Master — consumer
  // direct goes back to its region, reseller direct to the TLs covering that
  // region. Unmatched/unset rows stay in `direct` (never guessed).
  const regionOfKey = (key: string): string => {
    const r = String(((segmentByKey.get(key) as any)?.masterRegion) ?? '').trim();
    return isValidRegion(r) ? r : '';
  };
  const homeRegionOf = (row: { region?: unknown; customerName?: unknown; createdBy?: unknown }): string => {
    const own = String((row as any)?.region ?? '').trim();
    if (isValidRegion(own)) return own;
    const creator = String((row as any)?.createdBy ?? '').trim();
    if (!creator || !creatorIndex.knownIds.has(creator)) return '';
    return regionOfKey(normalizeClientKey((row as any)?.customerName));
  };
  const isRehomedDirect = (row: { region?: unknown; createdBy?: unknown }): boolean =>
    !String((row as any)?.region ?? '').trim() && !!String((row as any)?.createdBy ?? '').trim() && creatorIndex.knownIds.has(String((row as any)?.createdBy ?? ''));
  // Ledger-window re-homed rows (resolved home region + classified segment).
  const rehomeTargetConsumer = new Map<string, number>(); // weekStart|region → ₹ (region ledger top-up)
  const rehomeTargetReseller = new Map<string, number>(); // weekStart|region → ₹ (TL ledger top-up)
  for (const r of targetSnapshot.rows as any[]) {
    if (!isRehomedDirect(r)) continue;
    const home = homeRegionOf(r);
    if (!home) continue;
    const seg = segOf((r as any)?.customerName).segment;
    const week = weekStartOf(String((r as any)?.acceptedAt ?? ''));
    if (!week) continue;
    const v = Math.round(Number((r as any)?.total ?? 0) || 0);
    if (seg === 'consumer') {
      const k = `${week}|${home}`;
      rehomeTargetConsumer.set(k, (rehomeTargetConsumer.get(k) ?? 0) + v);
    } else if (seg === 'reseller') {
      const k = `${week}|${home}`;
      rehomeTargetReseller.set(k, (rehomeTargetReseller.get(k) ?? 0) + v);
    }
  }
  const regionLedgerWeeks = groupAcceptedByWeek(targetSnapshot.rows, weekStartOf);
  for (const [k, v] of rehomeTargetConsumer) {
    const sep = k.indexOf('|');
    const week = k.slice(0, sep);
    const region = k.slice(sep + 1);
    let byRegion = regionLedgerWeeks.get(week);
    if (!byRegion) { byRegion = new Map(); regionLedgerWeeks.set(week, byRegion); }
    byRegion.set(region, (byRegion.get(region) ?? 0) + v);
  }
  const targetByRegion: Map<string, RegionTarget> = buildRegionTargets({
    regions: REGIONS.map((r) => r.id),
    startDay: targetStart,
    asOfDay: todayDay,
    acceptedByWeek: regionLedgerWeeks,
    holidays,
  });

  const workingDays = periodMode && periodRangeInfo
    ? Math.max(1, workingDaysBetweenExcluding(periodRangeInfo.from, periodRangeInfo.to, holidays))
    : 1;

  // ── TL1 reseller targets (founder 2026-11-05) ────────────────────────────
  // Each TL1 owes ₹1L/working-day of RESELLER accepted ₹ summed across THEIR
  // TWO regions, with the same weekly carry-forward ledger as the region
  // end-consumer target. Consumer + unset ₹ never counts here (mirror image
  // of the region rule). TL identity comes from the roster pair
  // (region + region2, sales-head assigned).
  interface TlTargetRow {
    id: string;
    name: string;
    regions: RegionId[];
    perDay: number;
    target: RegionTarget | null;
    periodTarget: {
      from: string;
      to: string;
      workingDays: number;
      target: number;
      accepted: number;
      pct: number;
      met: boolean;
    };
    /** Period-window reseller split: TL's own closes vs team closes (both count to the TL total). */
    personal: { count: number; value: number };
    team: { count: number; value: number };
    /** Reseller deals behind the period total (capped 25, newest first). */
    items: Array<{
      estimateId: string;
      estimateNumber: string;
      customerName: string;
      total: number;
      region: string;
      acceptedAt: string;
      createdBy: string;
      createdByName: string | null;
      isPersonal: boolean;
      /** True when this was a sales-head direct close re-homed to the region. */
      viaSalesHead: boolean;
    }>;
  }
  const tlTargets: TlTargetRow[] = [];
  try {
    // Team Leads ONLY (founder 2026-11-05: `type='team_lead'` is its own role).
    // Sourcing by tlLevel leaked telecaller/field_staff rows labelled TL1 into
    // the race (9 rows for 2 defined TLs) — the role is authoritative.
    const tlStaff = (telecallers as any[]).filter(
      (t) => String((t as any).type ?? '') === 'team_lead' && !((t as any).deleted ?? false),
    );
    const resellerByWeekRegion = groupAcceptedByWeekFiltered(
      targetSnapshot.rows, weekStartOf,
      (row) => segOf(row.customerName).segment === 'reseller',
    );
    for (const [k, v] of rehomeTargetReseller) {
      const sep = k.indexOf('|');
      const week = k.slice(0, sep);
      const region = k.slice(sep + 1);
      let byRegion = resellerByWeekRegion.get(week);
      if (!byRegion) { byRegion = new Map(); resellerByWeekRegion.set(week, byRegion); }
      byRegion.set(region, (byRegion.get(region) ?? 0) + v);
    }
    const tlAcceptedByWeek = new Map<string, Map<string, number>>();
    const tlRegionLists = new Map<string, RegionId[]>();
    for (const t of tlStaff) {
      const id = String(t.id);
      const pair = tlRegions(t);
      if (pair.length === 0) continue;
      tlRegionLists.set(id, pair);
      for (const [week, byRegion] of resellerByWeekRegion) {
        let sum = 0;
        for (const r of pair) sum += byRegion.get(r) ?? 0;
        if (sum <= 0) continue;
        let byTl = tlAcceptedByWeek.get(week);
        if (!byTl) { byTl = new Map(); tlAcceptedByWeek.set(week, byTl); }
        byTl.set(id, (byTl.get(id) ?? 0) + sum);
      }
    }
    const tlIds = [...tlRegionLists.keys()];
    const tlLedger = tlIds.length > 0 ? buildRegionTargets({
      regions: tlIds,
      startDay: targetStart,
      asOfDay: todayDay,
      dailyTarget: DAILY_TL_RESELLER_TARGET,
      acceptedByWeek: tlAcceptedByWeek,
      holidays,
    }) : new Map<string, RegionTarget>();
    // Period-window reseller ₹ per TL (filter-period bar, no carry-in — same
    // shape as the region periodTarget so the frontend reuses one renderer).
    // EVERY reseller row in the TL's pair counts to the TL total; the split
    // below only explains WHO closed it (TL personal vs team).
    const periodResellerByTl = new Map<string, number>();
    const periodPersonalByTl = new Map<string, { count: number; value: number }>();
    const periodTeamByTl = new Map<string, { count: number; value: number }>();
    const itemsByTl = new Map<string, TlTargetRow['items']>();
    for (const row of wonSnapshot.rows) {
      if (segOf(row.customerName).segment !== 'reseller') continue;
      // Direct (sales-head) rows carry region '' — resolve through the master
      // so reseller direct flows to the TLs covering the home region.
      const effRegion = String((row as any).region ?? '').trim() || (isRehomedDirect(row as any) ? homeRegionOf(row as any) : '');
      if (!effRegion) continue;
      const rehomed = isRehomedDirect(row as any) && !String((row as any).region ?? '').trim();
      for (const [tlId, pair] of tlRegionLists) {
        if (pair.includes(effRegion as RegionId)) {
          const v = Math.round(Number(row.total ?? 0) || 0);
          periodResellerByTl.set(tlId, (periodResellerByTl.get(tlId) ?? 0) + v);
          const isPersonal = String((row as any).createdBy ?? '') === tlId;
          const bucket = isPersonal ? periodPersonalByTl : periodTeamByTl;
          const cur = bucket.get(tlId) ?? { count: 0, value: 0 };
          cur.count += 1; cur.value += v;
          bucket.set(tlId, cur);
          const list = itemsByTl.get(tlId) ?? [];
          list.push({
            estimateId: String((row as any).estimateId ?? ''),
            estimateNumber: String((row as any).estimateNumber ?? ''),
            customerName: String((row as any).customerName ?? ''),
            total: v,
            region: effRegion,
            acceptedAt: String((row as any).acceptedAt ?? ''),
            createdBy: String((row as any).createdBy ?? ''),
            createdByName: String((row as any).createdBy ?? '') ? (nameById.get(String((row as any).createdBy)) ?? (row as any).createdByName ?? null) : null,
            isPersonal,
            viaSalesHead: rehomed,
          });
          itemsByTl.set(tlId, list);
        }
      }
    }
    for (const list of itemsByTl.values()) {
      list.sort((a, b) => (b.acceptedAt.localeCompare(a.acceptedAt)) || (b.total - a.total));
      if (list.length > 25) list.length = 25;
    }
    const periodTlTarget = DAILY_TL_RESELLER_TARGET * workingDays;
    for (const t of tlStaff) {
      const id = String(t.id);
      const pair = tlRegionLists.get(id);
      if (!pair) continue;
      const target = tlLedger.get(id) ?? null;
      const accepted = Math.round(periodResellerByTl.get(id) ?? 0);
      const personal = periodPersonalByTl.get(id) ?? { count: 0, value: 0 };
      const team = periodTeamByTl.get(id) ?? { count: 0, value: 0 };
      tlTargets.push({
        id,
        name: String((t as any).name ?? ''),
        regions: pair,
        perDay: DAILY_TL_RESELLER_TARGET,
        target,
        personal: { count: personal.count, value: Math.round(personal.value) },
        team: { count: team.count, value: Math.round(team.value) },
        items: itemsByTl.get(id) ?? [],
        periodTarget: {
          from: periodRangeInfo?.from ?? day,
          to: periodRangeInfo?.to ?? day,
          workingDays,
          target: periodTlTarget,
          accepted,
          pct: periodTlTarget > 0 ? Math.round((accepted / periodTlTarget) * 100) : accepted > 0 ? 100 : 0,
          met: periodTlTarget > 0 ? accepted >= periodTlTarget : accepted > 0,
        },
      });
    }
    tlTargets.sort((a, b) => (b.periodTarget.pct - a.periodTarget.pct) || (b.periodTarget.accepted - a.periodTarget.accepted));
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'tl reseller targets failed — board renders without TL strip');
  }

  // Lead Generation targets scale with the period's working days (6-day work
  // week, Mon–Sat, minus national holidays) — a week target is one day ×
  // working days, never 1×.

  // ── Region + staff aggregation ──────────────────────────────────────────────
  // Per-creator consumer/reseller split (period window): lets the board show
  // normal telecaller sales vs TL-attributed reseller sales without implying
  // double counting — region totals stay estimate-region owned.
  const segSplitByCreator = new Map<string, { consumerWon: number; consumerValue: number; resellerWon: number; resellerValue: number; unclassifiedWon: number; unclassifiedValue: number }>();
  for (const r of wonSnapshot.rows) {
    const cid = String((r as any).createdBy ?? '');
    if (!cid) continue;
    const seg = segOf((r as any).customerName).segment;
    const cur = segSplitByCreator.get(cid) ?? { consumerWon: 0, consumerValue: 0, resellerWon: 0, resellerValue: 0, unclassifiedWon: 0, unclassifiedValue: 0 };
    const v = Math.round(Number((r as any).total ?? 0) || 0);
    if (seg === 'consumer') { cur.consumerWon += 1; cur.consumerValue += v; }
    else if (seg === 'reseller') { cur.resellerWon += 1; cur.resellerValue += v; }
    else { cur.unclassifiedWon += 1; cur.unclassifiedValue += v; }
    segSplitByCreator.set(cid, cur);
  }
  interface StaffRow {
    id: string;
    name: string;
    type: string;
    region: string;
    /** Secondary region for TL1s (two-region model, 2026-11-05). */
    region2: string;
    tlLevel: TlLevel;
    closerEligible: boolean;
    wonGenerator: number;
    wonCloser: number;
    won: number;
    closedValue: number;
    /** Period-window consumer/reseller split of this staff's own closes. */
    consumerWon: number;
    consumerValue: number;
    resellerWon: number;
    resellerValue: number;
    unclassifiedWon: number;
    unclassifiedValue: number;
    generatorPoints: number;
    closerPoints: number;
    points: number;
    callsAttempted: number;
    callsConnected: number;
    callsNotConnected: number;
    talkTimeSec: number;
    leadsGenerated: number;
    leadsConverted: number;
    leadsInProgress: number;
    leadsLost: number;
    score: number;
  }
  interface RegionRow {
    id: RegionId | '';
    name: string;
    tl: TlLevel;
    states: string[];
    /** Leaderboard position by FILTER-period consumer attainment (1 = best). */
    rank: number;
    leadsGenerated: number;
    won: { count: number; value: number };
    /** Same numbers as `won`, plus slab points (accepted-estimate source). */
    accepted: AcceptedAgg;
    /** Consumer / reseller / needs-review split of `won` (target honesty). */
    wonSplit: {
      consumer: { count: number; value: number };
      reseller: { count: number; value: number };
      unclassified: { count: number; value: number };
    };
    /** The closed estimates behind `accepted`, newest first (capped). */
    acceptedItems: AcceptedEstimate[];
    /** Declines that BECAME declined inside the period (the board's Declined stat). */
    declined: DeclinedAgg;
    /** The declined estimates behind `declined`, newest first (capped). */
    declinedItems: DeclinedEstimate[];
    /** Daily ₹1L target + weekly carry-forward ledger (targets.ts). */
    target: RegionTarget | null;
    /** Filter-period target: consumer-only accepted vs elapsed working days.
     *  Excludes carry-in by design — the backlog stays visible as its own
     *  badge (targets.ts ledger), never inside this bar. */
    periodTarget: {
      label: string;
      prefix: string;
      from: string;
      to: string;
      workingDays: number;
      target: number;
      accepted: number;
      pct: number;
      met: boolean;
      resellerValue: number;
      unclassifiedValue: number;
      unclassifiedCount: number;
    } | null;
    open: { count: number; value: number };
    callsAttempted: number;
    callsConnected: number;
    callsNotConnected: number;
    talkTimeSec: number;
    points: number;
    kra: {
      connectedTarget: number;
      connectedPct: number;
      connectedStatus: 'green' | 'amber' | 'red';
      leadsTarget: number;
      leadsPct: number;
      leadsStatus: 'green' | 'amber' | 'red';
    };
    staff: Array<Record<string, unknown>>;
  }
  const staffRows = new Map<string, StaffRow>();
  for (const t of telecallers as any[]) {
    const id = String(t.id);
    const nd = ndByTc.get(id) ?? {};
    const callsAttempted = Number(nd?.callsAttempted ?? 0) || 0;
    const callsConnected = Number(nd?.callsConnected ?? 0) || 0;
    const callsNotConnected = Number(nd?.callsNotConnected ?? 0) || 0;
    const talkTimeSec = Number(nd?.talkTimeSec ?? 0) || 0;
    const leadsConverted = Number(nd?.leadsConverted ?? 0) || 0;
    const leadsInProgress = Number(nd?.leadsInProgress ?? 0) || 0;
    const leadsLost = Number(nd?.leadsLost ?? 0) || 0;
    const leadsGenerated = leadsByAgent.get(id) ?? 0;
    // Wins/₹/points from accepted estimates this creator originated.
    const acc: AcceptedAgg = wonSnapshot.byCreator.get(id) ?? { count: 0, value: 0, points: 0 };
    const closedValue = Math.round(acc.value);
    // Historic −10/−15 penalties still apply once the epoch rule passes them.
    const points = Math.round(acc.points + (penaltiesByTc.get(id) ?? 0));
    const segSplit = segSplitByCreator.get(id) ?? { consumerWon: 0, consumerValue: 0, resellerWon: 0, resellerValue: 0, unclassifiedWon: 0, unclassifiedValue: 0 };
    staffRows.set(id, {
      id,
      name: String(t.name ?? ''),
      type: String((t as any).type ?? 'telecaller'),
      region: String((t as any).region ?? ''),
      region2: String((t as any).region2 ?? ''),
      tlLevel: ((t as any).tlLevel ?? '') as TlLevel,
      // Field staff generate leads only — never eligible as the 80% closer.
      closerEligible: !!(t as any).assignEstimateFollowUps && String((t as any).type ?? 'telecaller') !== 'field_staff',
      wonGenerator: acc.count,
      wonCloser: 0,
      won: acc.count,
      closedValue,
      consumerWon: segSplit.consumerWon,
      consumerValue: segSplit.consumerValue,
      resellerWon: segSplit.resellerWon,
      resellerValue: segSplit.resellerValue,
      unclassifiedWon: segSplit.unclassifiedWon,
      unclassifiedValue: segSplit.unclassifiedValue,
      generatorPoints: acc.points,
      closerPoints: 0,
      points,
      callsAttempted,
      callsConnected,
      callsNotConnected,
      talkTimeSec,
      leadsGenerated,
      leadsConverted,
      leadsInProgress,
      leadsLost,
      // Composite score (tunable, the leaderboard norm): accepted-slab points,
      // a generated lead +15, a connected call +0.5.
      score: points + leadsGenerated * 15 + Math.round(callsConnected * 0.5),
    });
  }

  // Period-window sales-head direct re-homes (resolved home region +
  // classified segment; unset/unmatched rows stay in `direct`).
  const rehomedWon: Array<{ row: AcceptedEstimate; home: string; seg: ClientSegmentKind }> = [];
  for (const r of wonSnapshot.rows as any[]) {
    if (!isRehomedDirect(r)) continue;
    const home = homeRegionOf(r);
    if (!home) continue;
    const seg = segOf(r?.customerName).segment;
    if (seg !== 'consumer' && seg !== 'reseller') continue;
    rehomedWon.push({ row: r as AcceptedEstimate, home, seg });
  }

  const regions: RegionRow[] = [];
  for (const def of REGIONS) {
    // Team Leads are NOT telecallers (founder 2026-11-05: `type='team_lead'`
    // is its own role) — they hang off the TL strip, never the staff rail.
    const members = (telecallers as any[]).filter((t) => String((t as any).region ?? '') === def.id && String((t as any).type ?? 'telecaller') !== 'team_lead')
      .map((t) => staffRows.get(String(t.id))).filter(Boolean) as StaffRow[];
    // Region wins/points come from the ESTIMATE's lead region (a founder
    // mapping or the creator's roster region — accepted.ts resolves both), so
    // a region's total never depends on who happened to hold a ledger row.
    // Sales-head direct re-homes land here too (consumer → region target).
    const baseAcc: AcceptedAgg = wonSnapshot.byRegion.get(def.id) ?? { count: 0, value: 0, points: 0 };
    let reWon = 0; let reValue = 0; let rePoints = 0;
    for (const h of rehomedWon) {
      if (h.home !== def.id) continue;
      reWon += 1;
      reValue += Math.round(Number((h.row as any).total ?? 0) || 0);
      rePoints += closePointsFor(Number((h.row as any).total ?? 0) || 0);
    }
    const acc: AcceptedAgg = { count: baseAcc.count + reWon, value: baseAcc.value + reValue, points: baseAcc.points + rePoints };
    const open = openByRegion.get(def.id) ?? { count: 0, value: 0 };
    const declined = declinedSnapshot.byRegion.get(def.id) ?? { count: 0, value: 0 };
    const callsAttempted = members.reduce((s, m) => s + m.callsAttempted, 0);
    const callsConnected = members.reduce((s, m) => s + m.callsConnected, 0);
    const callsNotConnected = members.reduce((s, m) => s + m.callsNotConnected, 0);
    const talkTimeSec = members.reduce((s, m) => s + m.talkTimeSec, 0);
    const leadsGenerated = members.reduce((s, m) => s + m.leadsGenerated, 0);
    const connectedTarget = CONNECTED_CALLS_PER_DAY * workingDays;
    const connectedPct = connectedTarget > 0 ? Math.round((callsConnected / connectedTarget) * 100) : 0;
    const connectedStatus: 'green' | 'amber' | 'red' =
      connectedPct >= 100 ? 'green' : connectedPct >= 60 ? 'amber' : 'red';
    const leadsTarget = LEADS_PER_AGENT_PER_DAY * workingDays;
    const leadsPct = leadsTarget > 0 ? Math.round((leadsGenerated / leadsTarget) * 100) : 0;
    const leadsStatus: 'green' | 'amber' | 'red' =
      leadsPct >= 100 ? 'green' : leadsPct >= 60 ? 'amber' : 'red';
    members.sort((a, b) => b.points - a.points || b.closedValue - a.closedValue || b.score - a.score);
    // Consumer split + filter-period target for this region. Splits come from
    // the FULL snapshot rows (never the capped drawer lists); the drawer rows
    // below are annotated with the same segment so every ₹ reconciles.
    // Re-homed sales-head direct rows join their home region here.
    const accRows = [
      ...wonSnapshot.rows.filter((r) => String(r.region ?? '') === def.id),
      ...rehomedWon.filter((h) => h.home === def.id).map((h) => h.row),
    ];
    const splitOf = (kind: ClientSegmentKind): { count: number; value: number } => {
      let count = 0; let value = 0;
      for (const r of accRows) {
        if (segOf(r.customerName).segment !== kind) continue;
        count += 1; value += Number(r.total ?? 0) || 0;
      }
      return { count, value: Math.round(value) };
    };
    const consumer = splitOf('consumer');
    const reseller = splitOf('reseller');
    const unclassified = splitOf('');
    const annotateItems = (items: AcceptedEstimate[]): AcceptedEstimate[] =>
      items.map((it) => {
        const s = segOf(it.customerName);
        return { ...it, segment: s.segment, segmentSource: s.source } as AcceptedEstimate;
      });
    const annotateDeclined = (items: DeclinedEstimate[]): DeclinedEstimate[] =>
      items.map((it) => {
        const s = segOf(it.customerName);
        return { ...it, segment: s.segment, segmentSource: s.source } as DeclinedEstimate;
      });
    // Filter target: elapsed working days × ₹1L vs consumer-only accepted.
    // Carry-in is deliberately NOT in this denominator (see periodTarget doc).
    const periodTargetValue = DAILY_REGION_TARGET * workingDays;
    const periodAccepted = consumer.value;
    const periodPct = periodTargetValue > 0
      ? Math.round((periodAccepted / periodTargetValue) * 100)
      : periodAccepted > 0 ? 100 : 0;
    regions.push({
      id: def.id,
      name: def.name,
      tl: def.tl,
      states: def.states,
      rank: 0,
      leadsGenerated,
      won: { count: acc.count, value: Math.round(acc.value) },
      accepted: acc,
      wonSplit: { consumer, reseller, unclassified },
      acceptedItems: (() => {
        const base = annotateItems(wonSnapshot.byRegionItems.get(def.id) ?? []);
        const re = rehomedWon.filter((h) => h.home === def.id).map((h) => {
          const s = segOf(h.row.customerName);
          return { ...(h.row as any), segment: s.segment, segmentSource: s.source, region: def.id, viaSalesHead: true } as AcceptedEstimate;
        });
        const merged = [...base, ...re];
        merged.sort((a: any, b: any) => String(b.acceptedAt ?? '').localeCompare(String(a.acceptedAt ?? '')) || (Number(b.total ?? 0) - Number(a.total ?? 0)));
        return merged.slice(0, 60);
      })(),
      declined: { count: declined.count, value: Math.round(declined.value) },
      declinedItems: annotateDeclined(declinedSnapshot.byRegionItems.get(def.id) ?? []),
      target: targetByRegion.get(def.id) ?? null,
      periodTarget: {
        label: periodRangeInfo?.label ?? 'Today',
        prefix: periodPrefix(typeof q.period === 'string' ? q.period : 'today'),
        from: periodRangeInfo?.from ?? day,
        to: periodRangeInfo?.to ?? day,
        workingDays,
        target: periodTargetValue,
        accepted: periodAccepted,
        pct: periodPct,
        met: periodTargetValue > 0 ? periodAccepted >= periodTargetValue : periodAccepted > 0,
        resellerValue: reseller.value,
        unclassifiedValue: unclassified.value,
        unclassifiedCount: unclassified.count,
      },
      open,
      callsAttempted,
      callsConnected,
      callsNotConnected,
      talkTimeSec,
      points: acc.points,
      kra: { connectedTarget, connectedPct, connectedStatus, leadsTarget, leadsPct, leadsStatus },
      staff: members as unknown as Array<Record<string, unknown>>,
    });
  }
  // One leaderboard, ranked REGIONWISE. Metric (founder decision 2026-11-02):
  // consumer-only attainment in the SELECTED filter period (elapsed working
  // days × ₹1L vs end-consumer accepted ₹) — so "This Month" ranks November
  // alone, never October's sales. Ties fall back to consumer accepted value.
  // The since-start ledger stays on the row as the backlog badge.
  [...regions]
    .sort((a, b) => (b.periodTarget?.pct ?? 0) - (a.periodTarget?.pct ?? 0) || (b.periodTarget?.accepted ?? 0) - (a.periodTarget?.accepted ?? 0))
    .forEach((r, i) => { r.rank = i + 1; });
  const unmappedStaff = (telecallers as any[]).filter((t) => !String((t as any).region ?? '') && !String((t as any).region2 ?? ''))
    .map((t) => staffRows.get(String(t.id))).filter(Boolean) as StaffRow[];
  for (const t of unmappedStaff) {
    // Highlighted on the board so MIS notices and maps them.
    (t as any).unmapped = true;
  }

  const openTotal = (sentOpen as any[]).reduce((s: number, e: any) => s + (Number(e.total ?? 0) || 0), 0);
  // KPI = the whole acceptance cohort in the window (regions + direct +
  // unlinked), so this header always reconciles with Zoho. The region slice is
  // broken out so nobody has to guess why the four region cards do not add up
  // to it — that mismatch used to be a silent ₹17.79L (Oct 2026).
  const regionWon = regions.reduce((s, r) => s + r.won.count, 0);
  const regionValue = regions.reduce((s, r) => s + r.won.value, 0);
  // Cohort consumer split (whole acceptance window, all buckets): Won stays
  // the total, the split explains which ₹ counts toward the ₹1L target.
  let consumerWon = 0; let consumerValue = 0;
  let resellerWon = 0; let resellerValue = 0;
  let unclassifiedWon = 0; let unclassifiedValue = 0;
  for (const r of wonSnapshot.rows) {
    const v = Math.round(Number(r.total ?? 0) || 0);
    const seg = segOf(r.customerName).segment;
    if (seg === 'consumer') { consumerWon += 1; consumerValue += v; }
    else if (seg === 'reseller') { resellerWon += 1; resellerValue += v; }
    else { unclassifiedWon += 1; unclassifiedValue += v; }
  }
  // Sales-head direct re-homes leave `direct` (consumer → home region, reseller
  // → TL strip via the same home region). The header still reconciles:
  // regions + direct(remaining) + unlinked = Won.
  const rehomedIds = new Set(rehomedWon.map((h) => String((h.row as any).estimateId ?? '')));
  const directRemaining = (wonSnapshot.direct.items as any[]).filter((it: any) => !rehomedIds.has(String(it?.estimateId ?? '')));
  let directReValue = 0;
  for (const h of rehomedWon) directReValue += Math.round(Number((h.row as any).total ?? 0) || 0);
  const kpi = {
    won: wonSnapshot.count,
    closedValue: Math.round(wonSnapshot.value),
    regionWon,
    regionValue,
    consumerWon,
    consumerValue,
    resellerWon,
    resellerValue,
    unclassifiedWon,
    unclassifiedValue,
    directWon: wonSnapshot.direct.count - rehomedWon.length,
    directValue: Math.round(wonSnapshot.direct.value) - directReValue,
    directRehomedWon: rehomedWon.length,
    directRehomedValue: directReValue,
    unlinkedWon: wonSnapshot.unlinked.count,
    unlinkedValue: Math.round(wonSnapshot.unlinked.value),
    pipelineValue: Math.round(openTotal),
    // Loss side of the same period (Declined stat + drawer). Additive only.
    declined: declinedSnapshot.total.count,
    declinedValue: Math.round(declinedSnapshot.total.value),
    declinedUnattributed: declinedSnapshot.unattributed.count,
    leadsGenerated: [...leadsByAgent.values()].reduce((s, n) => s + n, 0),
    callsAttempted: [...ndByTc.values()].reduce((s, nd) => s + (Number(nd?.callsAttempted ?? 0) || 0), 0),
    callsConnected: [...ndByTc.values()].reduce((s, nd) => s + (Number(nd?.callsConnected ?? 0) || 0), 0),
    talkTimeSec: [...ndByTc.values()].reduce((s, nd) => s + (Number(nd?.talkTimeSec ?? 0) || 0), 0),
  };

  // Team bar = the SUM of the four region targets. The old team-wide ₹5L/₹10L
  // bar is retired (founder decision 2026-10-26): it contradicted 4 × ₹1L and
  // left nobody sure which number they were being measured against.
  const teamWeek = [...targetByRegion.values()][0]?.current ?? null;
  const teamWeekTarget = regions.reduce((s, r) => s + (r.target?.weekTarget ?? 0), 0);
  const teamWeekAccepted = regions.reduce((s, r) => s + (r.target?.weekAccepted ?? 0), 0);
  const teamCarryIn = regions.reduce((s, r) => s + (r.target?.carryIn ?? 0), 0);
  const teamDue = regions.reduce((s, r) => s + (r.target?.weekDue ?? 0), 0);
  const teamPct = teamDue > 0 ? Math.round((teamWeekAccepted / teamDue) * 100) : 0;
  const teamTarget = {
    /** ₹ each region owes per working day. */
    perRegionPerDay: DAILY_REGION_TARGET,
    regions: REGIONS.length,
    teamPerDay: DAILY_REGION_TARGET * REGIONS.length,
    targetStart,
    asOfDay: todayDay,
    weekFrom: teamWeek?.weekStart ?? null,
    weekTo: teamWeek?.weekEnd ?? null,
    weekTarget: teamWeekTarget,
    weekAccepted: teamWeekAccepted,
    carryIn: teamCarryIn,
    due: teamDue,
    sinceStartTarget: regions.reduce((s, r) => s + (r.target?.sinceStart.target ?? 0), 0),
    sinceStartAccepted: regions.reduce((s, r) => s + (r.target?.sinceStart.accepted ?? 0), 0),
    pct: teamPct,
    status: teamPct >= 100 ? 'ontrack' : teamPct >= 60 ? 'behind' : 'critical',
    // Filter-period team bar (consumer-only): the number the tiles go green on.
    periodLabel: periodRangeInfo?.label ?? 'Today',
    periodPrefix: periodPrefix(typeof q.period === 'string' ? q.period : 'today'),
    periodFrom: periodRangeInfo?.from ?? day,
    periodTo: periodRangeInfo?.to ?? day,
    periodWorkingDays: workingDays,
    periodTarget: regions.reduce((s, r) => s + (r.periodTarget?.target ?? 0), 0),
    periodAccepted: regions.reduce((s, r) => s + (r.periodTarget?.accepted ?? 0), 0),
    periodPct: (() => {
      const t = regions.reduce((s, r) => s + (r.periodTarget?.target ?? 0), 0);
      const a = regions.reduce((s, r) => s + (r.periodTarget?.accepted ?? 0), 0);
      return t > 0 ? Math.round((a / t) * 100) : a > 0 ? 100 : 0;
    })(),
    periodConsumerValue: consumerValue,
    periodResellerValue: resellerValue,
    periodUnclassifiedValue: unclassifiedValue,
    periodUnclassifiedWon: unclassifiedWon,
  };

  // Self-contained staff list so the dashboard can build dropdowns without a
  // second round-trip.
  const agentList = telecallers.map((t: any) => ({
    id: String(t.id), name: String(t.name ?? ''),
    region: String(t.region ?? ''), region2: String(t.region2 ?? ''),
    regions: tlRegions(t), tlLevel: String(t.tlLevel ?? ''),
    active: !!t.assignEstimateFollowUps,
  }));

  // NeoDove users with no roster link — the Controller's link picker source.
  // Links are sales-head set on the roster row; auto-sync only fills empty
  // link fields, so this list is the entire manual-mapping queue.
  const unmappedNeodoveUsers: Array<{ userId: string; userName: string }> = [];
  try {
    const linkedNames = new Set((telecallers as any[]).map((t) => String((t as any)?.neodoveUserName ?? '').trim()).filter(Boolean));
    const linkedIds = new Set((telecallers as any[]).map((t) => String((t as any)?.neodoveUserId ?? '').trim()).filter(Boolean));
    const seenNeo = new Set<string>();
    for (const a of Object.values(neodoveMap ?? {}) as any[]) {
      const uid = String(a?.userId ?? '').trim();
      const uname = String(a?.userName ?? '').trim();
      const key = `${uid}‖${uname}`;
      if (!key || seenNeo.has(key)) continue;
      seenNeo.add(key);
      if ((uname && linkedNames.has(uname)) || (uid && linkedIds.has(uid))) continue;
      unmappedNeodoveUsers.push({ userId: uid, userName: uname });
      if (unmappedNeodoveUsers.length >= 100) break;
    }
    unmappedNeodoveUsers.sort((x, y) => x.userName.localeCompare(y.userName));
  } catch { /* picker list is best-effort — the board never depends on it */ }

  // ── Region drill-down: ?region=R1..R4|unmapped (or ?agent= → that staff's region)
  // Staff work every open estimate in their own region, so the drill shows the
  // whole region's pipeline (not a personal hold). A scoped staff member may
  // only ever drill into THEIR OWN region: any explicit ?agent=/?region= is
  // coerced to self (blocks reading other regions).
  const selfAgentId = typeof q.selfAgentId === 'string' && q.selfAgentId ? q.selfAgentId : null;
  const requestedAgent = typeof q.agent === 'string' && q.agent ? q.agent : undefined;
  const requestedRegionRaw = typeof q.region === 'string' ? String(q.region).trim() : '';
  const requestedRegion: string | undefined = requestedRegionRaw
    ? (requestedRegionRaw.toLowerCase() === 'unmapped' ? '' : requestedRegionRaw.toUpperCase())
    : undefined;
  const agentFilter = requestedAgent ? (selfAgentId ?? requestedAgent) : undefined;
  const drillSelfStaff = selfAgentId
    ? (telecallers as any[]).find((t) => String(t.id) === selfAgentId) ?? null
    : null;

  let drillStaff: any = null;
  let regionScope: string | undefined;
  if (selfAgentId) {
    // A scoped agent may only ever drill into THEIR OWN region — but a PLAIN
    // dashboard request (no ?region=, no ?agent=) must keep returning the full
    // leaderboard payload. Setting regionScope on every self-scoped request used
    // to short-circuit into the agent-drill response ({meta, agent, followUps}),
    // so every non-root/non-MIS viewer got a payload with NO `regions`, NO
    // `kpi` and NO `meta.teamTarget` — the dashboard rendered empty for them.
    if (agentFilter || requestedRegion !== undefined) {
      drillStaff = drillSelfStaff;
      regionScope = String(drillSelfStaff?.region ?? '');
    }
  } else if (agentFilter) {
    const tc = telecallers.find(
      (t: any) => String(t.id) === agentFilter || String(t.name ?? '') === agentFilter || (t.neodoveUserName ?? '') === agentFilter,
    ) as any;
    if (!tc) {
      return {
        meta: {
          analysis: 'sales-leaderboard',
          title: 'Sales Leaderboard',
          day,
          agents: agentList,
          generatedAt: new Date().toISOString(),
          error: 'agent not found',
        },
      };
    }
    drillStaff = tc;
    regionScope = String(tc.region ?? '');
  } else if (requestedRegion !== undefined) {
    regionScope = requestedRegion;
  }

  if (regionScope !== undefined) {
    const regionId = regionScope;
    const followUpEsts = await prisma.estimate.findMany({
      where: { region: regionId, status: 'sent' },
      // Highest-value estimates first — staff see the biggest deals at the
      // top of their region list.
      orderBy: [{ total: 'desc' }, { date: 'asc' }],
      // 15-min Zoho analyzer verdict — drives the Satisfactory/Unsatisfactory
      // chip. Note: D1PrismaClient resolves relations via `include`, not a
      // nested relation under `select`.
      include: { classification: true },
    });
    const followLastComments = new Map<string, string>();
    for (const r of riskItems) {
      if (r.lastCommentDate) followLastComments.set(r.estimateId, r.lastCommentDate);
    }
    // Most recent real sales note per follow-up estimate (text shown inline on
    // each row). Timestamp-ordered (Zoho ids aren't chronological); system
    // auto-logs excluded. Fail-open: rows render without the note.
    const latestCommentByEst = new Map<string, { text: string; commentedBy: string; dateFormatted: string | null }>();
    try {
      const ids = followUpEsts.map((e) => e.estimateId);
      if (ids.length > 0) {
        // Chunked at IN_BATCH — D1 caps bound variables at 100/statement.
        const rows: any[] = [];
        for (let i = 0; i < ids.length; i += IN_BATCH) {
          rows.push(...await prisma.comment.findMany({
            where: { estimateId: { in: ids.slice(i, i + IN_BATCH) } },
            select: { estimateId: true, description: true, commentedBy: true, date: true, dateFormatted: true },
          }));
        }
        const best = new Map<string, { ts: number; v: { text: string; commentedBy: string; dateFormatted: string | null } }>();
        for (const c of rows as any[]) {
          const text = String(c.description || '').trim();
          if (!text) continue;
          if (isSystemGeneratedComment(text, String(c.commentedBy || ''))) continue;
          const ts = parseCommentDateMs(String(c.dateFormatted ?? c.date ?? ''));
          if (ts === null) continue;
          const cur = best.get(String(c.estimateId));
          if (cur && cur.ts >= ts) continue;
          best.set(String(c.estimateId), {
            ts,
            v: {
              text,
              commentedBy: String(c.commentedBy || ''),
              dateFormatted: (c.dateFormatted ?? c.date ?? null) as string | null,
            },
          });
        }
        for (const [eid, v] of best) latestCommentByEst.set(eid, v.v);
      }
    } catch (e: any) {
      logger.warn({ err: e?.message }, 'follow-up latest-comment lookup failed — rows render without notes');
    }
    // Telecaller names for the call-tag "set by" attribution below.
    const nameByTelecallerId = new Map<string, string>(
      (telecallers as any[]).map((t) => [String(t.id), String(t.name ?? '')]),
    );
    const def = REGIONS.find((r) => r.id === regionId) ?? null;
    const followUps = followUpEsts.map((e) => {
      const lastCommentDate = followLastComments.get(e.estimateId) ?? null;
      const ts = parseCommentDateMs(lastCommentDate);
      const staleHours = ts !== null ? (nowMs - ts) / 3600000 : null;
      const riskItem = riskItems.find((r) => r.estimateId === e.estimateId);
      const risk = riskItem?.risk ?? 'pending';
      const callTagBy = (e as any).callTagBy ?? null;
      return {
        estimateId: e.estimateId,
        estimateNumber: e.estimateNumber,
        customerName: e.customerName,
        status: e.status,
        total: e.total,
        // Zoho org (multi-org sync) — drives the dashboard org badge/filter.
        organizationId: (e as any).organizationId ?? null,
        region: String((e as any).region ?? ''),
        day,
        satisfactory: (e as any).classification ? !!(e as any).classification.meaningfulUpdate : null,
        intentScore: (e as any).classification?.intentScore ?? null,
        analysisSummary: (e as any).classification?.summary ?? null,
        lastCommentDate,
        staleHours,
        // Most recent real sales note on THIS estimate (see lookup above).
        latestComment: latestCommentByEst.get(e.estimateId) ?? null,
        // Lead details: per-estimate capture ONLY (stored by the GH runner from this
        // estimate's own Zoho comments). NO company-name enquiry fallback — a
        // fuzzy company match can surface a DIFFERENT customer's POC/mobile/
        // enquiry number as wrong chips. Chips stay blank (UI shows the
        // "AI capturing" state) until the runner stores real per-estimate data.
        enquiryNumber: (e as any).enquiryNumber ?? null,
        sourceLead: (e as any).sourceLead ?? null,
        location: (e as any).location ?? null,
        contactName: (e as any).contactName ?? null,
        contactPhone: (e as any).contactPhone ?? null,
        contactEmail: (e as any).contactEmail ?? null,
        detailsCaptured: !!(e as any).detailsCaptured,
        // Terminal AI give-up: 10 capture turns with <3 fields (see the
        // lead-details route). UI shows "Details unavailable" instead of the
        // perpetual "AI capturing…" state.
        detailsFailed: !!(e as any).detailsFailed,
        // "Lead generated by" = the originating staff (creator) — the enquiry
        // author whose enquiry stamped the region. Hidden (null) until recorded.
        leadOf: (e as any).createdBy ? nameByTelecallerId.get(String((e as any).createdBy)) ?? null : null,
        risk,
        staleReason: riskItem?.staleReason ?? (risk === 'red' || risk === 'zombie' ? buildSnatchReason(e, risk) : null),
        // Agent call-disposition tag (Lead Conversion view): NO_ANSWER /
        // BUSY / CALLBACK (+callbackDate, max +10d). Sticky, engine-untouched.
        callTag: (e as any).callTag ?? null,
        callbackDate: (e as any).callbackDate ?? null,
        callTagBy,
        callTagByName: callTagBy ? (nameByTelecallerId.get(String(callTagBy)) ?? null) : null,
        callTagAt: (e as any).callTagAt ?? null,
        // Dated next step (migration 0028) — the restored NextStepControl
        // editor writes these via PUT /api/estimates/:id/next-step.
        nextStep: (e as any).nextStep ?? null,
        nextStepDate: (e as any).nextStepDate ?? null,
      };
    });
    const me = drillStaff ? staffRows.get(String(drillStaff.id)) ?? null : null;
    const regionRow = regions.find((r) => r.id === regionId) ?? null;
    // Region-level aggregate when no staff is targeted (Conversion region tabs):
    // sum the roster rows mapped to that region ('' = unmapped staff).
    const regionMembers = [...staffRows.values()].filter((s) => s.region === regionId);
    const agg = {
      won: me?.won ?? regionRow?.won.count ?? regionMembers.reduce((s, m) => s + m.won, 0),
      points: me?.points ?? regionRow?.points ?? Math.round(regionMembers.reduce((s, m) => s + m.points, 0)),
      callsConnected: me?.callsConnected ?? regionRow?.callsConnected ?? regionMembers.reduce((s, m) => s + m.callsConnected, 0),
      leadsGenerated: me?.leadsGenerated ?? regionRow?.leadsGenerated ?? regionMembers.reduce((s, m) => s + m.leadsGenerated, 0),
    };
    const regionOpen = openByRegion.get(regionId) ?? { count: 0, value: 0 };
    const staffName = drillStaff ? String(drillStaff.name ?? '') : null;
    return {
      meta: {
        analysis: 'sales-leaderboard-region',
        title: staffName ? `Sales Leaderboard — ${staffName}` : `Sales Leaderboard — ${def?.name ?? 'Unmapped'}`,
        day,
        requestedDay,
        region: regionId,
        regionName: def?.name ?? 'Unmapped',
        agents: agentList,
        generatedAt: new Date().toISOString(),
      },
      agent: {
        id: drillStaff ? String(drillStaff.id) : regionId,
        name: staffName ?? (def?.name ?? 'Unmapped'),
        region: regionId,
        tlLevel: drillStaff ? String(drillStaff.tlLevel ?? '') : (def?.tl ?? ''),
        won: agg.won,
        points: agg.points,
        callsConnected: agg.callsConnected,
        leadsGenerated: agg.leadsGenerated,
        regionOpen,
        followUpCount: followUps.length,
      },
      followUps,
    };
  }

  // ── Recent activity ──────────────────────────────────────────────────────────
  const recentRows = await prisma.estimate.findMany({
    where: { status: { in: ['sent', 'accepted', 'confirmed', 'declined'] } },
    orderBy: { lastSyncTime: 'desc' },
    take: 25,
    select: {
      estimateNumber: true,
      customerName: true,
      status: true,
      region: true,
    },
  });
  const recent = recentRows.map((e: any) => ({
    estimateNumber: e.estimateNumber,
    customerName: e.customerName,
    status: e.status,
    region: String(e.region ?? ''),
  }));

  // Can-manage: the route only injects selfAgentId for NON-admin users, so
  // its absence means the viewer is root/MIS/sales-head.
  const canManage = !selfAgentId;
  const selfStaff = selfAgentId ? staffRows.get(selfAgentId) ?? null : null;
  const selfRegion = selfStaff?.region ?? '';

  // Non-managing staff are scoped to their OWN region(s): the team leaderboard
  // (region cards) stays visible, but at-risk/recent lists carry only their
  // region's rows. TL1s covering two regions see BOTH (region + region2).
  const selfRegions = selfStaff ? [selfStaff.region, (selfStaff as StaffRow).region2].filter(Boolean) : [];
  const inSelfRegions = (r: string): boolean =>
    selfRegions.length === 0 ? !r : selfRegions.includes(r);
  const scopedRiskItems = canManage
    ? riskItems
    : riskItems.filter((r) => inSelfRegions(r.region));
  const scopedRecent = canManage
    ? recent
    : recent.filter((r) => inSelfRegions(String(r.region ?? '')));

  // Phase 3d sales shadow (leaderboard-only, log-only): compare core_sale vs
  // live Estimate headers + close ledger vs score events. Served values never
  // change — diffs log as `sales-shadow` SystemJob rows. Flip gate: one
  // matching week (7 days of closes with zero DIFF rows).
  // Phase 3e ledger shadow: per-estimate per-kind sums, legacy vs core_credit.
  try {
    const { shadowCompareSales, shadowCompareLedger } = await import('../../../modules/core/sales');
    await shadowCompareSales();
    await shadowCompareLedger();
  } catch { /* never block the leaderboard */ }
  return {
    meta: {
      analysis: 'sales-leaderboard',
      title: 'Sales Leaderboard',
      day,
      requestedDay,
      // TEMPORARY: which source the connected-call column reads (manual log vs
      // NeoDove). The Call Log tab owns the toggle.
      callsSource,
      period: periodMode && periodRangeInfo ? q.period : 'today',
      periodLabel: periodRangeInfo?.label ?? 'Today',
      periodFrom: periodRangeInfo?.from ?? null,
      periodTo: periodRangeInfo?.to ?? null,
      generatedAt: new Date().toISOString(),
      // Sales taxonomy: the region table first-class in the payload.
      taxonomy: REGIONS.map((r) => ({ id: r.id, name: r.name, tl: r.tl, states: r.states })),
      tlLevels: TL_LEVELS,
      canManage,
      unmatchedSentCount: unmappedCount,
      unmappedSentCount: unmappedCount,
      telecallerCount: telecallers.length,
      fieldStaffCount: (telecallers as any[]).filter((t) => String((t as any).type ?? 'telecaller') === 'field_staff').length,
      teamLeadCount: (telecallers as any[]).filter((t) => String((t as any).type ?? '') === 'team_lead').length,
      unmappedStaffCount: unmappedStaff.length,
      staff: agentList,
      agents: agentList,
      // NeoDove users with no roster link — Controller link-picker source.
      unmappedNeodoveUsers,
      // Enquiries in the window with no roster match (assignedAgentId empty).
      // Surfaced so MIS can fix attribution instead of silently undercounting.
      unattributedLeads,
      targets: {
        connectedCallsPerDay: CONNECTED_CALLS_PER_DAY * workingDays,
        leadsPerAgentPerDay: LEADS_PER_AGENT_PER_DAY * workingDays,
      },
      // Won-₹ goal. There is ONE target model now: ₹1L per region per working
      // day with weekly carry-forward (targets.ts). `teamTarget` is the sum of
      // the four regions; `conversionTarget` (the retired ₹5L/₹10L bar) is
      // gone on purpose — two competing bars made every number arguable.
      teamTarget,
      workingDays,
      selfAgentId: selfAgentId ?? null,
      viewer: {
        staffId: selfAgentId ?? null,
        name: selfStaff?.name ?? null,
        region: selfRegion || null,
        tlLevel: selfStaff?.tlLevel ?? null,
      },
      // History epoch (founder-approved live reset): points read start here.
      epoch,
      epochKey: EPOCH_SETTING_KEY,
    },
    kpi,
    // Founder pre-warning over the open pipeline (informational): no-activity
    // or stale next-step estimates, sorted by value.
    risk: {
      counts: {
        open: scopedRiskItems.length,
        ok: scopedRiskItems.filter((r) => r.risk === 'ok').length,
        pending: scopedRiskItems.filter((r) => r.risk === 'pending').length,
        red: scopedRiskItems.filter((r) => r.risk === 'red').length,
        zombie: scopedRiskItems.filter((r) => r.risk === 'zombie').length,
      },
      valueAtRisk: scopedRiskItems
        .filter((r) => r.risk === 'red' || r.risk === 'zombie')
        .reduce((s, r) => s + r.total, 0),
      atRisk: scopedRiskItems
        .filter((r) => r.risk === 'red' || r.risk === 'zombie')
        .sort((a, b) => b.total - a.total)
        .slice(0, RISK_LIST_CAP),
    },
    // Region cards — the heart of the sales leaderboard.
    regions,
    // TL1 reseller targets (founder 2026-11-05): one row per TL1 with a region
    // pair — ₹1L/working-day of reseller ₹ across their two regions, same
    // carry-forward ledger as regions. Rendered as the TL strip.
    tlTargets,
    // Staff working NO region (roster_tl/region unset) — actionable: map them.
    unmappedStaff,
    // Unmapped estimates (region '') across sent/accepted/confirmed/declined —
    // privileged only.
    ...(canManage ? {
      unmapped: {
        count: unmappedCount,
        value: Math.round(unmappedValue),
        items: unmappedSent,
      },
    } : {}),
    // Accepted value no region can claim — visible to EVERYONE, because these
    // rows are the answer to "why don't the region cards add up to the total?".
    // direct   = Sales Head / HQ remainder (resolved rows are re-homed: consumer
    //            → home region, reseller → TL strip via the same home region).
    // unlinked = no roster creator at all (needs an EST→region mapping).
    direct: {
      count: wonSnapshot.direct.count - rehomedWon.length,
      value: Math.round(wonSnapshot.direct.value) - directReValue,
      points: wonSnapshot.direct.points,
      items: directRemaining,
      label: 'Sales Head — Direct',
      kind: 'direct' as const,
      rehomedWon: rehomedWon.length,
      rehomedValue: directReValue,
    },
    unlinked: { ...roundAgg(wonSnapshot.unlinked), items: wonSnapshot.unlinked.items, label: 'Needs region mapping', kind: 'unlinked' },
    recent: scopedRecent,
    // MIS daily breakdown (only when ?daily=1 in period mode): per-day ×
    // per-staff closes w/ estimate tags, calls, leads. Absent otherwise so
    // dashboard loads stay light.
    ...(await buildDailySection(q, periodMode, periodRangeInfo)),
  };
}

/** Daily MIS section for period payloads. Empty (no keys) unless requested. */
export async function buildDailySection(
  q: Record<string, unknown>,
  periodMode: boolean,
  periodRangeInfo: { from: string; to: string; label: string } | null,
): Promise<{ daily?: TelecallingDailyRow[]; dailyError?: string | null }> {
  const wantDaily = String(q.daily ?? '') === '1' || String(q.daily ?? '').toLowerCase() === 'true';
  if (!wantDaily || !periodMode || !periodRangeInfo) return {};
  const res = await computeTelecallingDaily(periodRangeInfo.from, periodRangeInfo.to);
  if ('error' in res) return { dailyError: res.error };
  return { daily: res.rows, dailyError: null };
}

export async function listSalesHolidays(): Promise<SalesHoliday[]> {
  let rows: any[] = [];
  try {
    rows = await (prisma as any).salesHoliday.findMany({ orderBy: { day: 'asc' } });
  } catch {
    return [];
  }
  return (rows ?? []).map((r: any) => {
    const day = String(r?.day ?? '');
    return {
      day,
      label: String(r?.label ?? ''),
      markedBy: String(r?.markedBy ?? ''),
      markedByName: String(r?.markedByName ?? ''),
      createdAt: String(r?.createdAt ?? ''),
      sundayNoOp: isSunday(day),
    };
  });
}

export async function markSalesHoliday(input: {
  day: unknown; label?: unknown; markedBy?: string; markedByName?: string;
}): Promise<{ holiday: SalesHoliday; created: boolean }> {
  const day = String(input.day ?? '').trim();
  if (!DATE_RE.test(day)) {
    const e: any = new Error('day must be YYYY-MM-DD');
    e.status = 400;
    throw e;
  }
  const t = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  if (!Number.isFinite(t)) {
    const e: any = new Error('day is not a real date');
    e.status = 400;
    throw e;
  }
  const label = String(input.label ?? '').trim().slice(0, 120);
  const now = new Date().toISOString();
  try {
    const existing: any = await (prisma as any).salesHoliday.findUnique({ where: { day } });
    if (existing) {
      if (label && label !== String(existing.label ?? '')) {
        const updated: any = await (prisma as any).salesHoliday.update({
          where: { day }, data: { label },
        });
        return {
          holiday: {
            day, label: String(updated?.label ?? label),
            markedBy: String(existing?.markedBy ?? input.markedBy ?? ''),
            markedByName: String(existing?.markedByName ?? input.markedByName ?? ''),
            createdAt: String(existing?.createdAt ?? now),
            sundayNoOp: isSunday(day),
          },
          created: false,
        };
      }
      return {
        holiday: {
          day, label: String(existing?.label ?? ''),
          markedBy: String(existing?.markedBy ?? ''),
          markedByName: String(existing?.markedByName ?? ''),
          createdAt: String(existing?.createdAt ?? now),
          sundayNoOp: isSunday(day),
        },
        created: false,
      };
    }
    const created: any = await (prisma as any).salesHoliday.create({
      data: {
        day, label,
        markedBy: String(input.markedBy ?? ''),
        markedByName: String(input.markedByName ?? ''),
        createdAt: now,
      },
    });
    return {
      holiday: {
        day, label: String((created as any)?.label ?? label),
        markedBy: String((created as any)?.markedBy ?? input.markedBy ?? ''),
        markedByName: String((created as any)?.markedByName ?? input.markedByName ?? ''),
        createdAt: String((created as any)?.createdAt ?? now),
        sundayNoOp: isSunday(day),
      },
      created: true,
    };
  } catch (e: any) {
    if (e?.status) throw e;
    const err: any = new Error(e?.message || 'failed to mark holiday');
    err.status = 500;
    throw err;
  }
}

export async function unmarkSalesHoliday(dayInput: unknown): Promise<{ ok: boolean }> {
  const day = String(dayInput ?? '').trim();
  if (!DATE_RE.test(day)) {
    const e: any = new Error('day must be YYYY-MM-DD');
    e.status = 400;
    throw e;
  }
  try {
    await (prisma as any).salesHoliday.delete({ where: { day } });
  } catch {
    // Idempotent: removing a non-marked day still succeeds.
  }
  return { ok: true };
}
