/**
 * effort-sync.ts — NeoDove lead-call-log effort snapshots for the snatch shield.
 *
 * Every run reads the LIVE NeoDove token from D1 (`Token WHERE source='neodove'`
 * — never a pasted curl file, those session tokens die on re-login), then pulls
 * ALL pages of the `lead-call-log/fetch-lead-call-log-details` endpoint for
 * three IST windows (today, yesterday, day-before) and stores one normalized
 * snapshot per day in `Setting telecalling:effort:<YYYY-MM-DD>` (overwrite):
 *
 *   { day, fetchedAt, rows: [{ p: phoneLast10, u: neodoveUserId,
 *                              n: outgoingAttempts, spanH, conn: connected,
 *                              lastConn: mostRecentCallConnected,
 *                              firstTs, lastTs }] }
 *
 * Counting is per-IST-day — each snapshot stands alone, so yesterday's dials
 * never count toward today's shield (daily zeroing). The assignment engine
 * reads these snapshots (no API calls in the hot path) and evaluates the
 * shield for the CURRENT holder at snatch time.
 *
 * Fail-open by contract: missing/dead token or any API error records
 * `telecalling:effort:auth = { ok:false, at, error }` and returns ok:false —
 * the engine then behaves exactly as if no shield existed.
 */
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';

const NEODOVE_API = 'https://connect.neodove.com/api/v3';
const NEODOVE_PIPELINE_ID = '6960ffd81688fef4bc4df09a';

/** Endpoint page size; we loop `offset` until a short page (PoC: 206 rows/day). */
const PAGE_LIMIT = 100;
const MAX_PAGES_PER_DAY = 30;

export const EFFORT_SNAPSHOT_PREFIX = 'telecalling:effort:';
export const EFFORT_AUTH_KEY = 'telecalling:effort:auth';

/** Outcome codes observed on the API (verified in PoC, 2026-09-08). */
const CALL_TYPE_OUTGOING = 5;
const CALL_STATUS_CONNECTED = 2;

export interface EffortRow {
  /** Lead phone, last 10 digits (Zoho formats vary: '+91…', spaces). */
  p: string;
  /** NeoDove user id of the dialling agent (`call_initiated_by`). */
  u: string;
  /** EFFECTIVE outgoing attempts that day (redials merged — see below). */
  n: number;
  /** Raw dial count before merging (audit). */
  raw: number;
  /** First→last effective attempt span, hours. */
  spanH: number;
  /** Connected calls that day (any agent — evidence only, never verdict). */
  conn: number;
  /** Outcome of the MOST RECENT call that day (drives the 📵 no-pickup flag:
   *  the flag fires when the latest dial did not connect). Absent on rows
   *  written before this field existed (transitional — callers fall back). */
  lastConn?: boolean;
  firstTs: string;
  lastTs: string;
}

/**
 * Redial window: consecutive dials less than this apart are ONE effort, not
 * N (a 20-second redial is not a fresh attempt). 30 min keeps the genuine
 * "every ~2 hours" pattern untouched while killing burst gaming.
 */
const REDIAL_MERGE_MS = 30 * 60 * 1000;

/** Last-10-digit phone normalization (matches Estimate.contactPhone loosely). */
export function normPhone10(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function istDayStr(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(Date.now() + offsetDays * 86400000))
    .slice(0, 10);
}

/** IST day → epoch-ms window (IST midnight = 18:30 UTC of the previous day). */
function istDayEpochRange(dateStr: string): { start: number; end: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d - 1, 18, 30, 0);
  return { start, end: start + 24 * 3600 * 1000 - 1 };
}

async function readLiveToken(): Promise<string | null> {
  try {
    const row: any = await (prisma as any).token.findUnique({ where: { source: 'neodove' } });
    if (!row?.token) return null;
    try {
      const parsed = JSON.parse(row.token);
      return typeof parsed === 'string' ? parsed : String(parsed?.token ?? parsed);
    } catch {
      return String(row.token);
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'effort-sync: token read failed');
    return null;
  }
}

async function fetchDayRows(token: string, day: string): Promise<any[]> {
  const { start, end } = istDayEpochRange(day);
  const rows: any[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES_PER_DAY; page++) {
    const res = await fetch(`${NEODOVE_API}/lead-call-log/fetch-lead-call-log-details?application_type=PORTAL`, {
      method: 'POST',
      // Bound every page fetch — a stalled socket fails the sync (fail-open:
      // engine runs unshielded) instead of holding the runner endpoint.
      signal: AbortSignal.timeout(30000),
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        Referer: `https://connect.neodove.com/campaign/${NEODOVE_PIPELINE_ID}/call-logs`,
        loaderDivId: 'NEW_CALL_LOGS_PAGE_LOADER',
        'User-Agent': 'Mozilla/5.0',
        token,
      },
      body: JSON.stringify({
        pipeline_id: NEODOVE_PIPELINE_ID,
        is_fetch_count_only: false,
        filter: {
          lead_details: { lead_name: '', lead_number: '', lead_email: '', custom_column_filter_map: {} },
          call_duration_filter: { from_duration: null, to_duration: null, duration: null, type: null },
          // `type:'custom'` + explicit from/to returns the exact window (PoC-verified,
          // including past days — 'today'/'yesterday' behave identically).
          date_call_filter: { from_date: start, to_date: end, type: 'custom' },
          user_assigned_list: [],
          handled_by_list: [],
          call_direction_list: [],
          call_status_list: null,
          campaign_id_list: [],
          call_source_list: [],
          call_origin_list: [],
          show_historical_leads: false,
        },
        pagination: { limit: PAGE_LIMIT, offset, sort_by: 'date_call:DESC' },
      }),
    });
    if (res.status === 401) throw new Error('NeoDove rejected the token (401)');
    if (!res.ok) throw new Error(`neodove call-log HTTP ${res.status}`);
    const json: any = await res.json().catch(() => null);
    const page: any[] = Array.isArray(json) ? json : [];
    rows.push(...page);
    if (page.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }
  return rows;
}

function aggregateDay(day: string, apiRows: any[]): EffortRow[] {
  // per (phone10, agent): attempt { timestamp, connected } pairs; per
  // phone10: any-connect flag.
  const attempts = new Map<string, { ts: string; conn: boolean }[]>();
  const connectedPhones = new Set<string>();
  for (const r of apiRows) {
    if (r?.call_type !== CALL_TYPE_OUTGOING) continue;
    const p = normPhone10(r.phone ?? r.contact_number);
    const u = String(r.call_initiated_by ?? r.user_assigned ?? '');
    if (!p || !u) continue;
    const key = `${p}|${u}`;
    if (!attempts.has(key)) attempts.set(key, []);
    attempts.get(key)!.push({ ts: String(r.date_call), conn: r.call_status === CALL_STATUS_CONNECTED });
    if (r.call_status === CALL_STATUS_CONNECTED) connectedPhones.add(p);
  }
  const out: EffortRow[] = [];
  for (const [key, pairs] of attempts) {
    const [p, u] = key.split('|');
    const sorted = pairs.filter((x) => x.ts).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    // Merge redials: greedy groups where each dial is ≥30 min after the
    // previous group's first dial. n = effective attempts (groups).
    const groups: { ts: string; conn: boolean }[][] = [];
    for (const pr of sorted) {
      const last = groups[groups.length - 1];
      if (last && Date.parse(pr.ts) - Date.parse(last[0].ts) < REDIAL_MERGE_MS) last.push(pr);
      else groups.push([pr]);
    }
    const first = sorted[0].ts;
    const last = sorted[sorted.length - 1].ts;
    const spanH = sorted.length > 1
      ? Math.max(0, (Date.parse(last) - Date.parse(first)) / 3600000)
      : 0;
    out.push({
      p, u, n: groups.length, raw: sorted.length,
      spanH: Math.round(spanH * 10) / 10,
      conn: connectedPhones.has(p) ? 1 : 0,
      lastConn: sorted[sorted.length - 1].conn,
      firstTs: first, lastTs: last,
    });
  }
  return out;
}

async function writeSetting(key: string, value: string): Promise<void> {
  const existing: any = await (prisma as any).setting.findUnique({ where: { key } });
  if (existing) {
    await (prisma as any).setting.update({ where: { key }, data: { value, updatedAt: new Date() } });
  } else {
    await (prisma as any).setting.create({ data: { key, value, updatedAt: new Date() } });
  }
}

export interface EffortSyncResult {
  ok: boolean;
  days: { day: string; apiRows: number; groups: number }[];
  error?: string;
}

/**
 * Pull all pages for today + 2 prior IST days and persist per-day snapshots.
 * Never throws — callers (GH runner endpoint, cron) get { ok:false } instead.
 */
export async function syncEffortSnapshots(): Promise<EffortSyncResult> {
  const days = [istDayStr(0), istDayStr(-1), istDayStr(-2)];
  const token = await readLiveToken();
  if (!token) {
    await writeSetting(EFFORT_AUTH_KEY, JSON.stringify({ ok: false, at: new Date().toISOString(), error: 'no neodove token stored' })).catch(() => {});
    return { ok: false, days: [], error: 'no neodove token stored' };
  }
  try {
    const result: EffortSyncResult = { ok: true, days: [] };
    for (const day of days) {
      const apiRows = await fetchDayRows(token, day);
      const rows = aggregateDay(day, apiRows);
      await writeSetting(
        `${EFFORT_SNAPSHOT_PREFIX}${day}`,
        JSON.stringify({ day, fetchedAt: new Date().toISOString(), rows }),
      );
      result.days.push({ day, apiRows: apiRows.length, groups: rows.length });
    }
    await writeSetting(EFFORT_AUTH_KEY, JSON.stringify({ ok: true, at: new Date().toISOString() }));
    logger.info({ days: result.days }, 'effort-sync complete');
    return result;
  } catch (e: any) {
    const error = String(e?.message ?? e);
    logger.error({ err: error }, 'effort-sync failed — engine will run unshielded');
    await writeSetting(EFFORT_AUTH_KEY, JSON.stringify({ ok: false, at: new Date().toISOString(), error })).catch(() => {});
    return { ok: false, days: [], error };
  }
}

/** Read one day snapshot (null when missing/corrupt — treated as "no evidence"). */
export async function readEffortSnapshot(day: string): Promise<EffortRow[] | null> {
  try {
    const row: any = await (prisma as any).setting.findUnique({ where: { key: `${EFFORT_SNAPSHOT_PREFIX}${day}` } });
    if (!row?.value) return null;
    const parsed = JSON.parse(String(row.value));
    return Array.isArray(parsed?.rows) ? parsed.rows as EffortRow[] : null;
  } catch {
    return null;
  }
}
