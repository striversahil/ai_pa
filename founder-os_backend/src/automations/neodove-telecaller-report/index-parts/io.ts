// Extracted verbatim from index.ts by scripts/refactor/split-module.mjs.
// index.ts re-exports everything public here, so existing imports keep working.
import { cached, cacheDelPrefix } from "../../../shared/cache";
import { prisma } from "../../../shared/prisma";
import { isSystemGeneratedComment } from "../../../shared/systemComment";
import { logger } from "../../../shared/logger";
import type { AutomationContext } from "../../../modules/automation/types";
import { DATE_RE, aggregate, CONNECTED_CALLS_PER_DAY, LEADS_PER_AGENT_PER_DAY, NUMERIC_KEYS, computeAgentKra, ORDER } from "./pure";
import type { NeodoveAgentRow } from "./types";

/**
 * Load every stored user-day report between `from` and `to` (inclusive,
 * YYYY-MM-DD lexicographic range over the Settings key). Days whose snapshot
 * is empty (e.g. early-morning today mode) are skipped entirely so they do
 * not dilute per-day averages.
 */
export async function loadReportsInRange(from?: string, to?: string): Promise<{ dates: string[]; rows: any[] }> {
  const prefix = 'neodove_user_report:';
  const keyFilter: Record<string, unknown> = { startsWith: prefix };
  if (from && DATE_RE.test(from)) keyFilter.gte = `${prefix}${from}`;
  if (to && DATE_RE.test(to)) {
    // `~` sorts right after ':' so the upper bound includes exactly this date.
    keyFilter.lte = `${prefix}${to}~`;
  }

  // The same day-range is re-read by every dashboard on every broadcast, and
  // the underlying snapshots only change on the 5-min NeoDove refresh — so
  // cache the parsed read in KV. Invalidated explicitly on report writes.
  const rangeKey = `neodove:report_range:${from ?? '*'}:${to ?? '*'}`;
  const CACHE_TTL_MS = 5 * 60 * 1000;
  return cached<{ dates: string[]; rows: any[] }>(rangeKey, CACHE_TTL_MS, async () => {
    const settings = await prisma.setting.findMany({
      where: { key: keyFilter },
      orderBy: { key: 'desc' },
    });
    const dates: string[] = [];
    const rows: any[] = [];
    for (const s of settings) {
      const keyDate = s.key.slice(prefix.length);
      try {
        const parsed = JSON.parse(s.value);
        if (!Array.isArray(parsed?.rows)) continue;
        // Defence-in-depth: some stored snapshots contain rows dated outside
        // their key's day (NeoDove API ignores range params). Trust the ROW's
        // own date over the key when it is present.
        const inRange = parsed.rows.filter((r: any) => {
          const d = typeof r?.date === 'string' ? r.date.slice(0, 10) : null;
          if (!d || !DATE_RE.test(d)) return true;
          if (from && d < from) return false;
          if (to && d > to) return false;
          return true;
        });
        if (inRange.length > 0) {
          dates.push(keyDate);
          rows.push(...inRange);
        }
      } catch {
        // skip malformed snapshots
      }
    }
    return { dates, rows };
  });
}

/** Invalidate all cached NeoDove reads when a report snapshot is (re)written. */
export async function invalidateNeodoveCache(): Promise<void> {
  await Promise.all([
    cacheDelPrefix('neodove:report_range'),
    cacheDelPrefix('neodove:kra'),
    cacheDelPrefix('telecalling:dashboard'),
  ]);
}

/**
 * Load the per-agent NeoDove aggregates for a single day (default: latest stored
 * day) keyed by agent userName. Used by the unified telecalling dashboard to
 * merge Lead Generation (calls connected / leads generated) with Lead
 * Conversion (estimate assignments) per telecaller.
 */
export async function getNeodoveAgentMap(date?: string): Promise<Record<string, NeodoveAgentRow>> {
  const d = date && DATE_RE.test(date) ? date : undefined;
  const { rows } = await loadReportsInRange(d, d);
  const aggregated = aggregate(rows);
  const map: Record<string, NeodoveAgentRow> = {};
  for (const a of aggregated) {
    if (a.userName) map[a.userName] = a;
    if (a.userId) map[a.userId] = a;
  }
  return map;
}

/**
 * Unique NeoDove agents across every stored day. Used to seed the Telecaller
 * roster — a telecaller is considered active once they appear in any NeoDove
 * report (including previous days), so the roster is built from the full
 * history, not just today's (possibly empty) snapshot.
 */
export async function getAllNeodoveAgents(): Promise<NeodoveAgentRow[]> {
  const { rows } = await loadReportsInRange(undefined, undefined);
  return aggregate(rows);
}

/** Aggregated NeoDove metrics per agent over an inclusive IST date range
 * (YYYY-MM-DD strings). Used by the telecalling leaderboard for week/month/
 * year period views — sums the stored daily reports in one Setting read. */
export async function getNeodoveRangeMap(
  from: string,
  to: string,
): Promise<Record<string, NeodoveAgentRow>> {
  const { rows } = await loadReportsInRange(from, to);
  const aggregated = aggregate(rows);
  const map: Record<string, NeodoveAgentRow> = {};
  for (const a of aggregated) {
    if (a.userName) map[a.userName] = a;
    if (a.userId) map[a.userId] = a;
  }
  return map;
}

/** Latest stored NeoDove report day that actually has agent rows (YYYY-MM-DD),
 * or null if none stored. Skips empty snapshots (e.g. early-morning "today"
 * that hasn't been pushed yet) so callers fall back to real data. */
export async function getLatestNeodoveDay(): Promise<string | null> {
  const { dates } = await loadReportsInRange(undefined, undefined);
  return dates.length ? dates[0] : null;
}

export async function loadZohoNameMap(): Promise<Record<string, string>> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'kra:zoho_name_map' } });
    if (!row?.value) return {};
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Attribute active sent estimates to agents via comments.commentedBy.
 * Returns stats keyed by *NeoDove* user name (after mapping), plus the raw
 * per-Zoho-commenter breakdown so unmapped names stay visible.
 */
export async function loadZohoByAgent(nameMap: Record<string, string>): Promise<{
  byAgent: Record<string, { estimates: number; value: number }>;
  byZohoName: Record<string, { estimates: number; value: number }>;
}> {
  // D1 row-read budget protection: the attribution scan reads every open
  // estimate + every comment row. Cache the result in KV for 10 min — the
  // NeodoveTelecallerDashboard refetches on every runner broadcast, and the
  // underlying Zoho data only changes on the 15-min sync.
  const CACHE_KEY = 'neodove:kra_cache';
  const TTL_MS = 10 * 60 * 1000;

  const result = await cached<{ byAgent: Record<string, { estimates: number; value: number }>; byZohoName: Record<string, { estimates: number; value: number }> }>(
    CACHE_KEY,
    TTL_MS,
    async () => {
      const byAgent: Record<string, { estimates: number; value: number }> = {};
      const byZohoName: Record<string, { estimates: number; value: number }> = {};

      const normalizedMap: Record<string, string> = {};
      for (const [zoho, neo] of Object.entries(nameMap)) {
        if (zoho && neo) normalizedMap[zoho.trim().toLowerCase()] = neo.trim();
      }

      try {
        const estimates = await prisma.estimate.findMany({
          where: { status: 'sent' },
          include: { comments: { orderBy: { commentId: 'desc' } } },
        });
        for (const e of estimates as any[]) {
          const commenters = new Set<string>();
          for (const c of e.comments ?? []) {
            const who = String(c.commentedBy ?? '').trim();
            if (who && !isSystemGeneratedComment(c.description, who)) commenters.add(who);
          }
          for (const who of commenters) {
            const zstats = (byZohoName[who] ??= { estimates: 0, value: 0 });
            zstats.estimates += 1;
            zstats.value += Number(e.total) || 0;
            const mapped = normalizedMap[who.toLowerCase()];
            if (mapped) {
              const astats = (byAgent[mapped] ??= { estimates: 0, value: 0 });
              astats.estimates += 1;
              astats.value += Number(e.total) || 0;
            }
          }
        }
      } catch (err) {
        logger.warn({ err }, 'KRA: failed to attribute Zoho estimates');
      }
      return { byAgent, byZohoName };
    },
  );

  return result;
}

export async function handler(ctx: AutomationContext): Promise<void> {
  ctx.log('info', 'neodove-telecaller-report: data is pushed by GH Actions runner; nothing to execute here');
}

export async function data(ctx: AutomationContext): Promise<any> {
  const q = ctx.subject ?? {};
  let from = typeof q.from === 'string' && DATE_RE.test(q.from) ? q.from : undefined;
  let to = typeof q.to === 'string' && DATE_RE.test(q.to) ? q.to : undefined;
  if (from && !to) to = from;
  if (to && !from) from = to;
  const legacyDate = typeof q.date === 'string' && DATE_RE.test(q.date) ? q.date : undefined;
  if (!from && legacyDate) from = legacyDate;
  // No params at all → latest stored day only.
  if (!from && !to && !legacyDate) {
    const latest = await prisma.setting.findFirst({
      where: { key: { startsWith: 'neodove_user_report:' } },
      orderBy: { key: 'desc' },
    });
    from = latest?.key.slice('neodove_user_report:'.length);
    to = from;
  }
  const connectedTarget = Number(ctx.config?.connectedCallsPerDay ?? CONNECTED_CALLS_PER_DAY) || CONNECTED_CALLS_PER_DAY;
  const leadsTarget = Number(ctx.config?.leadsPerAgentPerDay ?? LEADS_PER_AGENT_PER_DAY) || LEADS_PER_AGENT_PER_DAY;
  // No params → latest stored day; explicit from/to (or date) → inclusive multi-day range.
  const { dates, rows } = await loadReportsInRange(from, from ? (to ?? from) : undefined);
  if (!rows.length) {
    return {
      meta: {
        analysis: 'neodove-live',
        title: 'Telecaller Performance (NeoDove Live)',
        reportDate: null,
        range: from ? { from, to: to ?? from, days: 0 } : null,
        configured: true,
        generatedAt: new Date().toISOString(),
        error:
          'No NeoDove report stored for the requested range — waiting for GH Actions runner pushes (backfill via workflow_dispatch input neodove_backfill_days).',
      },
      agents: [],
      totals: null,
      benchmarks: { connectedCallsPerDay: connectedTarget, leadsPerAgentPerDay: leadsTarget },
      zohoUnmapped: [],
    };
  }
  const days = dates.length;
  const nameMap = await loadZohoNameMap();
  const { byAgent: zohoByAgent, byZohoName } = await loadZohoByAgent(nameMap);
  const baseAgents = aggregate(rows);
  const totals = baseAgents.reduce(
    (acc, a) => {
      for (const k of NUMERIC_KEYS) {
        (acc as Record<string, number>)[k] += Number(a[k] ?? 0);
      }
      return acc;
    },
    Object.fromEntries(NUMERIC_KEYS.map((k) => [k, 0])) as Record<typeof NUMERIC_KEYS[number], number>,
  );
  const agents = baseAgents.map((a) => ({
    ...a,
    kra: computeAgentKra(a, connectedTarget, leadsTarget, zohoByAgent[a.userName], days),
  }));
  agents.sort((x, y) => {
    if (ORDER[y.kra.overall] !== ORDER[x.kra.overall]) return ORDER[x.kra.overall] - ORDER[y.kra.overall];
    return y.kra.connectedPct - x.kra.connectedPct;
  });
  const mappedZohoNames = new Set(
    Object.keys(nameMap).map((k) => k.trim().toLowerCase()),
  );
  const zohoUnmapped = Object.entries(byZohoName)
    .filter(([name]) => !mappedZohoNames.has(name.trim().toLowerCase()))
    .map(([name, s]) => ({ zohoName: name, estimates: s.estimates, value: s.value }));
  logger.info({ range: from ? `${from}..${to}` : 'latest', days, agents: agents.length }, 'NeoDove report data served');
  return {
    meta: {
      analysis: 'neodove-live',
      title: 'Telecaller Performance (NeoDove Live)',
      reportDate: dates[0] ?? null,
      range: from ? { from, to: to ?? from, days } : { from: dates[0], to: dates[0], days },
      dates,
      fetchedAt: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      agentCount: agents.length,
    },
    benchmarks: { connectedCallsPerDay: connectedTarget, leadsPerAgentPerDay: leadsTarget },
    agents,
    totals,
    zohoUnmapped,
  };
}
