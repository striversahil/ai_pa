#!/usr/bin/env node

/**
 * neodove-report-runner.js — daily NeoDove telecaller report.
 *
 * 1. Fetches the NeoDove JWT from the worker token store (GET /api/token/neodove).
 * 2. Calls NeoDove's internal call-log-report API for one IST day
 *    (default: yesterday — complete data; override with `node neodove-report-runner.js YYYY-MM-DD`).
 * 3. Stores the normalized rows in D1 via POST /api/runner/neodove/report
 *    (Settings key `neodove_user_report:YYYY-MM-DD`).
 *
 * Env:
 *   WORKER_URL, SHARED_SECRET   — worker access (required)
 *   NEODOVE_USER_IDS            — comma-separated user ids (optional; defaults to the org roster)
 *
 * Token refresh: if the stored JWT is expired/invalid the API returns 401 and this
 * runner exits 1 — post a fresh token via POST /api/token/webhook (source=neodove).
 */

const { workerRequest } = require('./runner-lib.js');

const missing = ['WORKER_URL', 'SHARED_SECRET'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const NEODOVE_API = 'https://connect.neodove.com/api/v3';
const DEFAULT_USER_IDS = [
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
].join(',');

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function istDateStr(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now).slice(0, 10);
}

// NeoDove expects JS Date.toString() style ranges, e.g.
// "Thu Aug 20 2026 00:00:00 GMT+0530 (India Standard Time)"
function istRangeStrings(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const prefix = `${DAYS[dt.getUTCDay()]} ${MONTHS[dt.getUTCMonth()]} ${d} ${y}`;
  const tz = 'GMT+0530 (India Standard Time)';
  return { startDate: `${prefix} 00:00:00 ${tz}`, endDate: `${prefix} 23:59:59 ${tz}` };
}

// IST day → epoch-ms range (NeoDove get-leads expects lead_date_created in ms).
// IST midnight = 18:30 UTC of the previous day; span a full 24h window.
function istDayEpochRange(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d - 1, 18, 30, 0);
  return { start, end: start + 24 * 3600 * 1000 - 1 };
}

/**
 * Number of leads GENERATED (created) per telecaller on a given IST day.
 *
 * This replaces the previous buggy `leadsInProgress + leadsConverted` heuristic
 * from the USER_REPORT call-log snapshot. We query NeoDove's `get-leads` API
 * per telecaller (filtering by `user_id_list`) over the day's created-date
 * range and count the returned leads — that is the true "leads generated"
 * figure. Network failures degrade to 0 (the live path runs from Cloudflare/
 * local egress where NeoDove is reachable; GH Actions egress is blocked).
 */
const NEODOVE_PIPELINE_ID = '6960ffd81688fef4bc4df09a';
async function fetchLeadsGenerated(token, dateStr, userIds) {
  const { start, end } = istDayEpochRange(dateStr);
  const counts = {};
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
          lead_stage_list: [],
          tag_list: [],
          user_id_list: [uid],
          lead_date_created: { start_date: start, end_date: end, is_date_changed: true },
          next_followup_date: {},
          contact_source: [],
          contact_list_ids: [],
          campaign_ids_list: [],
          show_historical_leads: false,
          isFilterApplied: true,
          customfilterSelected: 'today',
        },
        pagination: { limit: 50, offset },
        sort_by: { sorting_type: 0 },
        selected_contact_source: [],
        selected_uploaded_files: [],
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
      if (res.status === 401) throw new Error('NeoDove rejected the token (401) — refresh it via POST /api/token/webhook');
      if (!res.ok) throw new Error(`neodove get-leads HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = await res.json();
      const arr = json?.data?.data || json?.data?.leads || (Array.isArray(json?.data) ? json.data : []);
      count += Array.isArray(arr) ? arr.length : 0;
      pages++;
      if (!Array.isArray(arr) || arr.length < 50 || pages > 50) break;
      offset += 50;
    }
    counts[uid] = count;
  }
  return counts;
}

function jwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function rowDateStr(r) {
  const raw = r.dateString || r.date || '';
  // dateString → "YYYY-MM-DD"; raw date → ISO "YYYY-MM-DDTHH:mm:ss.sssZ"
  return String(raw).slice(0, 10);
}

async function fetchReportRows(token, dateStr) {
  const { startDate, endDate } = istRangeStrings(dateStr);
  const userIds = process.env.NEODOVE_USER_IDS || DEFAULT_USER_IDS;
  const params = new URLSearchParams({
    reportName: 'USER_REPORT',
    startDate,
    endDate,
    usersId: userIds,
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
  if (res.status === 401) throw new Error('NeoDove rejected the token (401) — refresh it via POST /api/token/webhook');
  if (!res.ok) throw new Error(`neodove call-log-report HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const all = Array.isArray(json?.data?.data) ? json.data.data : [];
  // NeoDove returns rows spanning neighbouring days regardless of the
  // requested range — keep ONLY rows whose own date matches the requested
  // IST day so snapshots never mix days.
  const filtered = all.filter((r) => rowDateStr(r) === dateStr);
  if (all.length !== filtered.length) {
    console.log(`[neodove] dropped ${all.length - filtered.length} row(s) outside ${dateStr} (API ignores range params)`);
  }
  return filtered;
}

function normalizeRow(r) {
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
    leadsGenerated: r.leadsGenerated ?? 0,
  };
}

(async () => {
  const arg = process.argv[2] || '';
  const todayMode = arg === '--today';
  let reportDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) reportDate = arg;
  else if (todayMode) reportDate = istDateStr(0);
  else reportDate = istDateStr(-1); // default: yesterday's complete data
  console.log(`[neodove] report for IST day ${reportDate}${todayMode ? ' (today/intraday)' : ''}`);

  // 1. token from worker store
  let tokenInfo;
  try {
    tokenInfo = await workerRequest('/api/token/neodove');
  } catch (e) {
    console.error(`[neodove] no token stored: ${e.message}`);
    process.exit(1);
  }
  const token = typeof tokenInfo.token === 'string' ? tokenInfo.token : '';
  if (!token) {
    console.error('[neodove] stored token is empty — post a fresh one to /api/token/webhook');
    process.exit(1);
  }
  const exp = jwtExpiry(token);
  if (exp && exp < Date.now()) {
    console.error(`[neodove] token expired at ${new Date(exp).toISOString()} — refresh required`);
    process.exit(1);
  }
  console.log(`[neodove] token ok${exp ? ` (expires ${new Date(exp).toISOString()})` : ''}`);

  // 2. fetch + normalize
  const rawRows = await fetchReportRows(token, reportDate);
  if (!rawRows.length && !todayMode) {
    console.error(`[neodove] empty report for ${reportDate} — aborting without overwrite`);
    process.exit(1);
  }

  // 2b. true "leads generated" per telecaller via the get-leads API (replaces
  // the buggy leadsInProgress + leadsConverted heuristic). Degrades to 0 on
  // network failure so the rest of the snapshot still stores.
  const userIds = (process.env.NEODOVE_USER_IDS || DEFAULT_USER_IDS).split(',').map((s) => s.trim()).filter(Boolean);
  let leadsByUser = {};
  try {
    leadsByUser = await fetchLeadsGenerated(token, reportDate, userIds);
    const total = Object.values(leadsByUser).reduce((a, b) => a + b, 0);
    console.log(`[neodove] leads generated today (get-leads): ${total} across ${Object.keys(leadsByUser).length} telecallers`);
  } catch (e) {
    console.warn(`[neodove] leads-generated fetch failed (storing 0): ${e.message}`);
  }

  const rows = rawRows.map((r) => {
    const n = normalizeRow(r);
    n.leadsGenerated = leadsByUser[r.userId] ?? 0;
    return n;
  });
  console.log(`[neodove] fetched ${rows.length} user-day rows${rows.length === 0 ? ' (empty — early-morning today mode, storing empty day)' : ''}`);

  // 3. store in D1
  const out = await workerRequest('/api/runner/neodove/report', {
    method: 'POST',
    body: { reportDate, report: { rows } },
  });
  console.log(`[neodove] stored ${out.count} rows under ${out.key}`);
})().catch((e) => {
  console.error(`[neodove] FAILED: ${e.message}`);
  process.exit(1);
});
