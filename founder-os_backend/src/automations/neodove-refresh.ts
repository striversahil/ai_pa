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

function normalizeRow(r: any) {
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

  // 4. store snapshot (overwrite semantics — same as the GH runner)
  const key = `neodove_user_report:${reportDate}`;
  const payload = JSON.stringify({
    rows: filtered.map(normalizeRow),
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
  return {
    ok: true,
    reportDate,
    stored: filtered.length,
    dropped: all.length - filtered.length,
  };
}
