import { GoogleSheetsService } from '../../modules/google_sheets/service';
import type { AutomationContext, ScanRecord } from '../../modules/automation/types';

/**
 * Telecalling agents analysis. All analysis code lives in this folder;
 * the shared Google Sheets API is referenced from modules/google_sheets.
 * `handler` runs on the schedule (logs a scan summary), `data` powers the
 * dashboard at GET /api/automations/telecalling-agent-analysis/data.
 */

function parseTalkTimeToMinutes(timeStr: string | null | undefined): number {
  if (!timeStr) return 0;
  const cleaned = String(timeStr).toLowerCase().trim();
  if (/^\d+$/.test(cleaned)) return parseInt(cleaned) || 0;
  if (cleaned.includes('min')) {
    const match = cleaned.match(/(\d+)\s*min/);
    if (match) return parseInt(match[1]);
  }
  let minutes = 0;
  let seconds = 0;
  const mMatch = cleaned.match(/(\d+)m/);
  if (mMatch) minutes = parseInt(mMatch[1]);
  const sMatch = cleaned.match(/(\d+)s/);
  if (sMatch) seconds = parseInt(sMatch[1]);
  return Number((minutes + seconds / 60).toFixed(1));
}

function parseSheetDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const cleaned = String(dateStr).trim();
  const dmyMatch = cleaned.match(/^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2,4})$/i);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1]);
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = months.indexOf(dmyMatch[2].toLowerCase());
    let year = parseInt(dmyMatch[3]);
    if (year < 100) year += 2000;
    return new Date(year, month, day);
  }
  const ymdMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) return new Date(parseInt(ymdMatch[1]), parseInt(ymdMatch[2]) - 1, parseInt(ymdMatch[3]));
  const mdMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdMatch) return new Date(parseInt(mdMatch[3]), parseInt(mdMatch[1]) - 1, parseInt(mdMatch[2]));
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d;
  return null;
}

const getEmployeeName = (row: any) => String(row['Employee Name'] || row['Agent Name'] || row['Agent'] || 'Unknown').trim();
const getWorkAssigned = (row: any) => String(row['Work Assigned'] || row['Role'] || 'Telecaller').trim();
const getDialed = (row: any) => parseInt(row['Outgoing Calls Count'] || row['Total Calls Dialed'] || row['Dialed Calls'] || '0') || 0;
const getConnected = (row: any) => parseInt(row['Total Connected Calls Count'] || row['Answered Calls'] || row['Connected Calls'] || '0') || 0;
const getTalkTime = (row: any) => parseTalkTimeToMinutes(row['Total Call Duration'] || row['Talk Time'] || row['Call Duration'] || '');
const getConfirmed = (row: any) => parseInt(row['Total SO Created- Count'] || row['Confirmed Orders'] || row['SO Count'] || '0') || 0;
const getDriveLink = (row: any) => row['Calling Report Screenshot'] || row['Calling Report Screenshot 2'] || row['Drive Link'] || '';
const getLeadsTotal = (row: any) => {
  const inc = parseInt(row['Leads From Incoming'] || row['Leads Incoming'] || '0') || 0;
  const out = parseInt(row['Leads From Outgoing'] || row['Leads Outgoing'] || '0') || 0;
  const ai = parseInt(row['Leads From AI'] || row['Leads AI'] || '0') || 0;
  return inc + out + ai;
};

const DEFAULT_MAX_DAILY_SO = 50;

/**
 * SO counts are often polluted by data-entry errors — e.g. the SO *amount*
 * (74,635) pasted into the count column, or a mistyped 6,379. One such row
 * silently inflates the whole period total, so rows above the per-day cap are
 * excluded from the aggregates and flagged as data-quality warnings instead.
 */
function soCount(row: any, maxDailySO: number): number {
  const raw = getConfirmed(row);
  if (raw > maxDailySO) return 0;
  return raw;
}

function soWarnings(rows: ScanRecord[], maxDailySO: number): any[] {
  const warnings: any[] = [];
  rows.forEach((row: any) => {
    const raw = getConfirmed(row);
    if (raw > maxDailySO) {
      warnings.push({
        sNo: String(row.Date || row._rowId || 'N/A'),
        company: getEmployeeName(row),
        field: 'Total SO Created- Count',
        issue: `SO count ${raw} exceeds the sane daily cap (${maxDailySO}) — likely an amount pasted into the count column. Excluded from totals.`,
        severity: 'critical',
      });
    }
  });
  return warnings;
}

const isOnlyLeadGen = (role: string) => {
  const r = role.toLowerCase();
  return r === 'telle caller' || r === 'telecaller' || r === 'lead generator';
};

function filterByDate(rows: ScanRecord[], ctx: AutomationContext): ScanRecord[] {
  const start = String(ctx.subject?.start ?? '');
  const end = String(ctx.subject?.end ?? '');
  if (!start && !end) return rows;
  const s = parseSheetDate(start);
  const e = parseSheetDate(end);
  if (!s && !e) return rows;
  const sTime = s ? new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime() : 0;
  const eTime = e ? new Date(e.getFullYear(), e.getMonth(), e.getDate()).getTime() : Infinity;
  return rows.filter((row) => {
    const dateField = row.Date || row.Timestamp;
    if (!dateField) return true;
    const d = parseSheetDate(dateField);
    if (!d) return true;
    const rTime = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return rTime >= sTime && rTime <= eTime;
  });
}

function aggregate(rows: ScanRecord[], maxDailySO: number): any[] {
  const aggMap: Record<string, any> = {};
  rows.forEach((row: any) => {
    const emp = getEmployeeName(row);
    if (!emp || emp === 'Unknown' || emp === '') return;
    if (!aggMap[emp]) {
      aggMap[emp] = {
        name: emp,
        role: getWorkAssigned(row),
        daysCount: 0,
        totalDialed: 0,
        totalConnected: 0,
        totalTalktime: 0,
        totalConfirmed: 0,
        leadsTotal: 0,
      };
    }
    aggMap[emp].daysCount += 1;
    aggMap[emp].totalDialed += getDialed(row);
    aggMap[emp].totalConnected += getConnected(row);
    aggMap[emp].totalTalktime += getTalkTime(row);
    aggMap[emp].totalConfirmed += soCount(row, maxDailySO);
    aggMap[emp].leadsTotal += getLeadsTotal(row);
  });
  return Object.values(aggMap);
}

function insights(aggregated: any[]): { good: any[]; inconsistent: any[] } {
  const goodList: any[] = [];
  const inconsistentList: any[] = [];

  aggregated.forEach((emp: any) => {
    const connRate = emp.totalDialed > 0 ? emp.totalConnected / emp.totalDialed : 0;
    const leadRate = emp.totalConnected > 0 ? emp.leadsTotal / emp.totalConnected : 0;
    const soRate = emp.totalConnected > 0 ? emp.totalConfirmed / emp.totalConnected : 0;
    const isLeadGen = isOnlyLeadGen(emp.role);

    if (isLeadGen) {
      const isStarLeadGen = leadRate >= 0.12 && emp.leadsTotal >= 20;
      const isGoodLeadGen = leadRate >= 0.09 && emp.leadsTotal >= 10 && !isStarLeadGen;
      const isLowLeadGen = leadRate < 0.08 && emp.totalConnected >= 30;
      const description = `Dials: ${emp.totalDialed} | Connects: ${emp.totalConnected} | Leads: ${emp.leadsTotal}`;
      if (isStarLeadGen) goodList.push({ name: emp.name, role: emp.role, badge: 'Star Lead Gen 🎯', desc: `${description} (${Math.round(leadRate * 100)}% Lead Rate)` });
      else if (isGoodLeadGen) goodList.push({ name: emp.name, role: emp.role, badge: 'Good Lead Gen 👍', desc: `${description} (${Math.round(leadRate * 100)}% Lead Rate)` });
      else if (isLowLeadGen) inconsistentList.push({ name: emp.name, role: emp.role, badge: 'Low Lead Rate ⚠️', desc: `${description} (${Math.round(leadRate * 100)}% Lead Rate, needs efficiency training)` });
    } else {
      const isStarConverter = soRate >= 0.04 && emp.totalConfirmed >= 15;
      const isGoodConverter = soRate >= 0.025 && emp.totalConfirmed >= 5 && !isStarConverter;
      const isLowConverter = soRate < 0.02 && emp.totalConnected >= 30;
      const description = `Dials: ${emp.totalDialed} | Connects: ${emp.totalConnected} | SOs: ${emp.totalConfirmed}`;
      if (isStarConverter) goodList.push({ name: emp.name, role: emp.role, badge: 'Star Performer 🌟', desc: `${description} (${Math.round(soRate * 100)}% SO rate)` });
      else if (isGoodConverter) goodList.push({ name: emp.name, role: emp.role, badge: 'Good Performer 👍', desc: `${description} (${Math.round(soRate * 100)}% SO rate)` });
      else if (isLowConverter) inconsistentList.push({ name: emp.name, role: emp.role, badge: 'Low Conversions 📉', desc: `${description} (${Math.round(soRate * 100)}% SO rate, needs conversion coaching)` });
    }
  });

  return { good: goodList, inconsistent: inconsistentList };
}

function buildDashboard(rows: ScanRecord[], maxDailySO: number): any {
  const aggregated = aggregate(rows, maxDailySO);

  let totalSO = 0;
  let totalCallsDialed = 0;
  let totalCallsConnected = 0;
  let totalLeads = 0;
  rows.forEach((row: any) => {
    const emp = getEmployeeName(row);
    if (!emp || emp === 'Unknown' || emp === '') return;
    totalSO += soCount(row, maxDailySO);
    totalCallsDialed += getDialed(row);
    totalCallsConnected += getConnected(row);
    totalLeads += getLeadsTotal(row);
  });
  const callRate = totalCallsDialed > 0 ? Math.round((totalCallsConnected / totalCallsDialed) * 100) : 0;
  const soRate = totalCallsConnected > 0 ? Math.round((totalSO / totalCallsConnected) * 100) : 0;
  const leadGenRate = totalCallsConnected > 0 ? Math.round((totalLeads / totalCallsConnected) * 100) : 0;

  const leaderboard = [...aggregated].sort((a: any, b: any) => {
    const isAGen = isOnlyLeadGen(a.role);
    const isBGen = isOnlyLeadGen(b.role);
    if (isAGen !== isBGen) return isAGen ? 1 : -1;
    if (isAGen) return b.leadsTotal - a.leadsTotal;
    return b.totalConfirmed - a.totalConfirmed;
  }).map((emp: any, idx: number) => {
    const rate = emp.totalDialed > 0 ? Math.round((emp.totalConnected / emp.totalDialed) * 100) : 0;
    const leadRate = emp.totalConnected > 0 ? Math.round((emp.leadsTotal / emp.totalConnected) * 100) : 0;
    const conv = emp.totalConnected > 0 ? Math.round((emp.totalConfirmed / emp.totalConnected) * 100) : 0;
    return [
      idx + 1,
      emp.name,
      emp.role,
      emp.totalDialed,
      emp.totalConnected,
      `${rate}%`,
      emp.leadsTotal,
      `${leadRate}%`,
      isOnlyLeadGen(emp.role) ? '—' : emp.totalConfirmed,
      isOnlyLeadGen(emp.role) ? '—' : `${conv}%`,
    ];
  });

  const rawLog = rows.map((row: any) => [
    row.Date ?? '',
    getEmployeeName(row),
    getWorkAssigned(row),
    getDialed(row),
    getConnected(row),
    row['Total Call Duration'] || row['Talk Time'] || '0',
    getLeadsTotal(row),
    getConnected(row) > 0 ? `${Math.round((getLeadsTotal(row) / getConnected(row)) * 100)}%` : '0%',
    isOnlyLeadGen(getWorkAssigned(row)) ? '—' : getConfirmed(row),
    getDriveLink(row) || '',
    row.Remarks ?? '',
  ]);

  return {
    kpis: [
      { label: 'Total SO Created', value: `${totalSO} orders`, sub: 'Total sales orders generated', accent: 'indigo' },
      { label: 'Call Connection Rate', value: `${callRate}% (${totalCallsConnected}/${totalCallsDialed})`, sub: 'Successful call connections ratio', accent: 'emerald' },
      { label: 'Total Leads Generated', value: `${totalLeads} Leads`, sub: `Lead Gen Rate: ${leadGenRate}% of connected`, accent: 'violet' },
      { label: 'SO Conversion Rate', value: `${soRate}%`, sub: 'SO Created / Connected calls ratio', accent: 'amber' },
    ],
    insights: insights(aggregated),
    warnings: soWarnings(rows, maxDailySO),
    tables: [
      {
        title: 'Telecaller Connection & SO Conversion Leaderboard',
        columns: ['Rank', 'Employee Name', 'Work Assigned', 'Calls Dialed', 'Calls Connected', 'Call Connection Rate', 'Leads Generated', 'Lead Gen Rate', 'SO Created (Conversions)', 'SO Conversion Rate'],
        rows: leaderboard,
      },
      {
        title: 'Raw Telecaller Sheet Data',
        columns: ['Date', 'Employee Name', 'Work Assigned', 'Outgoing Calls', 'Connected Calls', 'Talk Time', 'Leads Generated', 'Lead Gen Rate', 'SO Created', 'Report Screenshot', 'Remarks'],
        rows: rawLog,
      },
    ],
  };
}

export async function handler(ctx: AutomationContext): Promise<void> {
  const sheetUrl = String(ctx.config.sheetUrl ?? '');
  const range = String(ctx.config.range ?? 'A1:Z1000');
  const maxDailySO = Number(ctx.config.maxDailySO ?? DEFAULT_MAX_DAILY_SO) || DEFAULT_MAX_DAILY_SO;
  const result = await GoogleSheetsService.getSpreadsheetData(sheetUrl, range);
  if (!result.configured) {
    ctx.log('warn', 'Telecalling sheet scan skipped: Google Sheets not configured', {});
    return;
  }
  const dash = buildDashboard(result.rows, maxDailySO);
  ctx.log('info', 'Telecalling sheet scan complete', {
    rows: result.rows.length,
    soCreated: dash.kpis[0].value,
    leads: dash.kpis[2].value,
    agents: (dash.tables[0]?.rows ?? []).length,
    outlierRows: dash.warnings.length,
  });
}

export async function data(ctx: AutomationContext): Promise<any> {
  const sheetUrl = String(ctx.config.sheetUrl ?? '');
  const range = String(ctx.config.range ?? 'A1:Z1000');
  const maxDailySO = Number(ctx.config.maxDailySO ?? DEFAULT_MAX_DAILY_SO) || DEFAULT_MAX_DAILY_SO;
  const result = await GoogleSheetsService.getSpreadsheetData(sheetUrl, range);
  const rows = filterByDate(result.rows ?? [], ctx);
  const dash = buildDashboard(rows, maxDailySO);
  return {
    meta: {
      analysis: 'sheet',
      title: 'Telecalling Agents',
      spreadsheetUrl: sheetUrl,
      range,
      rowsRead: rows.length,
      configured: result.configured,
      generatedAt: new Date().toISOString(),
      ...(result.error ? { error: result.error } : {}),
    },
    ...dash,
  };
}
