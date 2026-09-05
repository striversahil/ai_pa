/**
 * neodove-refresh.ts — server-side NeoDove USER_REPORT refresh.
 *
 * Port of scripts/neodove-report-runner.js (--today mode). Runs inside the
 * Worker because GitHub Actions egress IPs are blocked by connect.neodove.com
 * (the 10-min GH workflow failed ~90% of runs; local/Cloudflare egress works).
 *
 * Fetches the call-log-report for TODAY (IST), keeps only rows whose own
 * date matches the requested IST day (the API ignores range params and
 * returns rows spanning neighbouring days), normalizes them, and overwrites
 * the D1 Setting key `neodove_user_report:<YYYY-MM-DD>`.
 */
import { logger } from '../shared/logger';
import { prisma } from '../shared/prisma';
import { invalidateNeodoveCache } from './neodove-telecaller-report';

const NEODOVE_API = 'https://connect.neodove.com/api/v3';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function istDateStr(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(Date.now() + offsetDays * 86400000))
    .slice(0, 10);
}

// NeoDove expects JS Date.toString() style ranges,
// e.g. "Thu Aug 20 2026 00:00:00 GMT+0530 (India Standard Time)"
function istRangeStrings(dateStr: string): { startDate: string; endDate: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const prefix = `${DAYS[dt.getUTCDay()]} ${MONTHS[dt.getUTCMonth()]} ${d} ${y}`;
  const tz = 'GMT+0530 (India Standard Time)';
  return { startDate: `${prefix} 00:00:00 ${tz}`, endDate: `${prefix} 23:59:59 ${tz}` };
}

function rowDateStr(r: any): string {
  const raw = r.dateString || r.date || '';
  return String(raw).slice(0, 10);
}

// IST day → epoch-ms range (NeoDove get-leads expects lead_date_created in ms).
// IST midnight = 18:30 UTC of the previous day; span a full 24h window.
function istDayEpochRange(dateStr: string): { start: number; end: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d - 1, 18, 30, 0);
  return { start, end: start + 24 * 3600 * 1000 - 1 };
}

const NEODOVE_PIPELINE_ID = '6960ffd81688fef4bc4df09a';
// Pipeline stage that defines a "generated" lead in the portal counter.
const NEODOVE_LEAD_STAGE_ID = '3ce47616-4c90-4564-b7a9-66e8a0d35f2d';

/**
 * True "leads generated" per telecaller on a given IST day, via the
 * `get-leads` API. Matches the NeoDove portal's lead-generation counter:
 * leads at a specific pipeline stage whose LAST CALL falls inside the day
 * (the older created-date-based `lead_date_created` heuristic produced
 * incorrect counts and has been removed). We query once per telecaller
 * (filtering by `user_id_list`) over the day's last-call epoch window and
 * count returned leads. Returns a userId→count map; on failure returns an
 * empty map (caller stores 0).
 */
async function fetchLeadsGenerated(token: string, dateStr: string, userIds: string[]): Promise<Record<string, number>> {
  const { start, end } = istDayEpochRange(dateStr);
  const isToday = dateStr === istDateStr(0);
  const counts: Record<string, number> = {};
  for (const uid of userIds) {
    let offset = 0;
    let count = 0;
    let pages = 0;
    while (true) {
      const body = {
        campaign_id: null,
        pipeline_id: NEODOVE_PIPELINE_ID,
        campaign_name: null,
        timezone_offset: 330,
        view_lead_filter: {
          basic_search: {},
          lead_status: null,
          customFollowupFilterSelected: null,
          lead_stage_list: [NEODOVE_LEAD_STAGE_ID],
          tag_list: [],
          latest_disposition_list: [],
          user_id_list: [uid],
          campaign_ids_list: [],
          // Creation date intentionally NOT filtered — the counter is driven
          // by the lead's last call landing inside the requested IST day.
          lead_date_created: { is_date_changed: false, start_date: null, end_date: null },
          next_followup_date: {},
          contact_source: [],
          contact_list_ids: [],
          call_not_connected_reason_list: [],
          last_call_date: {
            call_not_connected_reason_list: [],
            start_date: start,
            end_date: end,
            is_filter_applied: true,
            dispositionDateForFilter: isToday ? 'today' : undefined,
          },
          show_historical_leads: false,
          isFilterApplied: true,
        },
        selected_contact_source: [],
        selected_uploaded_files: [],
        selected_workflow: [],
        selected_google_sheet: [],
        pagination: { limit: 50, offset },
        sort_by: { sorting_type: 0 },
        fetch_purpose: 'VIEW_LEADS',
      };
      const res = await fetch(`${NEODOVE_API}/lead/get-leads?application_type=PORTAL`, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          Referer: `https://connect.neodove.com/leads/${NEODOVE_PIPELINE_ID}`,
          loaderDivId: 'LEAD_SUMMARY_PAGE_LOADER',
          token,
        },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        throw new Error('NeoDove rejected the token (401)');
      }
      if (!res.ok) {
        throw new Error(`neodove get-leads HTTP ${res.status}`);
      }
      const json: any = await res.json().catch(() => null);
      // The page of rows sits under data.campaign_leads for this filter shape
      // (older response shapes kept as fallbacks). Missing this key means the
      // count silently reads 0 even on HTTP 200.
      const rawPage: any = json?.data?.campaign_leads ?? json?.data?.data ?? json?.data?.leads
        ?? (Array.isArray(json?.data) ? json.data : null);
      const arr: any[] = Array.isArray(rawPage) ? rawPage : [];
      count += Array.isArray(arr) ? arr.length : 0;
      pages++;
      if (!Array.isArray(arr) || arr.length < 50 || pages > 50) break;
      offset += 50;
    }
    counts[uid] = count;
  }
  return counts;
}

function normalizeRow(r: any, leadsGenerated = 0) {
  return {
    userId: r.userId,
    userName: r.userName || null,
    managerId: r.managerId || null,
    managerName: r.managerName || null,
    date: r.dateString || (r.date ? String(r.date).slice(0, 10) : null),
    callsAttempted: r.totalCallAttempted ?? 0,
    callsConnected: r.totalCallConnected ?? 0,
    callsNotConnected: r.totalCallNotConnected ?? 0,
    incomingCalls: r.totalIncomingCalls ?? 0,
    outgoingCalls: r.totalOutgoingCalls ?? 0,
    incomingMissed: r.totalIncomingMissed ?? 0,
    outgoingMissed: r.totalOutgoingMissed ?? 0,
    talkTimeSec: (r.totalOutgoingCallDuration ?? 0) + (r.totalIncomingCallDuration ?? 0),
    firstCallAt: r.firstCallAttemptedAt || null,
    leadsInProgress: r.totalInprogressLead ?? 0,
    leadsConverted: r.totalConvertedLead ?? 0,
    leadsLost: r.totalLostLead ?? 0,
    leadsClosed: r.totalClosedLead ?? 0,
    followupLeads: r.totalFollowupLeads ?? 0,
    pendingScheduledLeads: r.totalPendingScheduledLeads ?? 0,
    leadsGenerated,
  };
}

async function fetchRosterUserIds(): Promise<string[]> {
  const rows = await prisma.token.findMany({
    where: { source: { startsWith: 'neodove_user:' } },
    select: { source: true },
  });
  return rows.map((r) => r.source.slice('neodove_user:'.length));
}

/**
 * Refresh today's (or a specific IST day's) snapshot. Returns a summary.
 */
export async function refreshNeodoveReport(dateStr?: string): Promise<{
  ok: boolean;
  reportDate: string;
  stored: number;
  dropped?: number;
  error?: string;
}> {
  const reportDate = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : istDateStr(0);

  // 1. token
  const tokenRow = await prisma.token.findUnique({ where: { source: 'neodove' } });
  if (!tokenRow) return { ok: false, reportDate, stored: 0, error: 'no neodove token stored' };
  let token: string;
  try {
    const parsed = JSON.parse(tokenRow.token);
    token = typeof parsed === 'string' ? parsed : String(parsed?.token ?? parsed);
  } catch {
    token = tokenRow.token;
  }

  // 2. user ids (roster tokens if present, else the known org ids)
  let userIds = await fetchRosterUserIds();
  if (!userIds.length) {
    userIds = [
      '72922361-beb1-45db-af6d-873563273614',
      'c43e439e-6982-4ee4-a948-2d369a367260',
      '3fbaea54-c641-40e7-940e-f36a99da81af',
      '3ff267f7-2b0d-48d0-a245-e7c8cd6325f4',
      '13889a99-6339-4e8a-94f8-8ec72b744cbd',
      '3518625a-a527-4b5b-9cdc-0600a91291cc',
      '3a113421-04f3-4498-b1f9-4a341d7ce5cb',
      '2a4bcd20-527a-4432-a97a-e8e8f3838f77',
      '45a8a21b-c112-4702-8be8-a20b6cfb954d',
      '65caf525-d4e9-4684-83ab-3bfdca74757f',
    ];
  }

  // 3. fetch report (API ignores range params — we filter by row date)
  const { startDate, endDate } = istRangeStrings(reportDate);
  const params = new URLSearchParams({
    reportName: 'USER_REPORT',
    startDate,
    endDate,
    usersId: userIds.join(','),
    managersId: '',
    application_type: 'PORTAL',
  });
  const res = await fetch(`${NEODOVE_API}/report/call-log-report?${params}`, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://connect.neodove.com/reports/user-report',
      token,
    },
  });
  if (res.status === 401) {
    return { ok: false, reportDate, stored: 0, error: 'NeoDove rejected the token (401)' };
  }
  if (!res.ok) {
    return { ok: false, reportDate, stored: 0, error: `neodove HTTP ${res.status}` };
  }
  const json: any = await res.json().catch(() => null);
  const all = Array.isArray(json?.data?.data) ? json.data.data : [];
  const filtered = all.filter((r: any) => rowDateStr(r) === reportDate);

  // 3b. true "leads generated" per telecaller via get-leads (replaces the
  // buggy leadsInProgress + leadsConverted heuristic). Degrades to 0 on error.
  let leadsByUser: Record<string, number> = {};
  try {
    leadsByUser = await fetchLeadsGenerated(token, reportDate, userIds);
    const total = Object.values(leadsByUser).reduce((a, b) => a + b, 0);
    logger.info({ reportDate, total, telecallers: Object.keys(leadsByUser).length }, 'neodove leads-generated fetched');
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'neodove leads-generated fetch failed');
  }

  // 4. store snapshot (overwrite semantics — same as the GH runner)
  const key = `neodove_user_report:${reportDate}`;
  const payload = JSON.stringify({
    rows: filtered.map((r: any) => normalizeRow(r, leadsByUser[r.userId] ?? 0)),
    fetchedAt: new Date().toISOString(),
  });
  const existing = await prisma.setting.findUnique({ where: { key } });
  if (existing) {
    await prisma.setting.update({ where: { key }, data: { value: payload, updatedAt: new Date() } });
  } else {
    await prisma.setting.create({ data: { key, value: payload, updatedAt: new Date() } });
  }
  logger.info(
    { reportDate, fetched: all.length, stored: filtered.length, dropped: all.length - filtered.length },
    'neodove refresh complete',
  );
  // Invalidate the KV-cached report reads + KRA attribution so dashboards pick
  // up the new snapshot immediately.
  await invalidateNeodoveCache();
  return {
    ok: true,
    reportDate,
    stored: filtered.length,
    dropped: all.length - filtered.length,
  };
}
