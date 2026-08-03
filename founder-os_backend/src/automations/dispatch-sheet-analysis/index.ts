import { GoogleSheetsService } from '../../modules/google_sheets/service';
import type { AutomationContext, ScanRecord } from '../../modules/automation/types';

/**
 * Dispatch & CRM Tracker analysis. All analysis code lives in this folder;
 * the shared Google Sheets API is referenced from modules/google_sheets.
 * `handler` runs on the schedule (logs a scan summary), `data` powers the
 * dashboard at GET /api/automations/dispatch-sheet-analysis/data.
 */

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

function parseRemarkDates(remarkStr: string | null | undefined): Date[] {
  if (!remarkStr) return [];
  const regex = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/g;
  const dates: Date[] = [];
  let match;
  while ((match = regex.exec(String(remarkStr))) !== null) {
    const day = parseInt(match[1]);
    const month = parseInt(match[2]) - 1;
    let year = parseInt(match[3]);
    if (year < 100) year += 2000;
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) dates.push(d);
  }
  return dates;
}

function getSOAmount(row: Record<string, any>): number {
  return parseFloat(String(pick(row, 'Total Amount', 'Amount') || '0').replace(/[^0-9.]/g, '')) || 0;
}

/**
 * First non-empty value among candidate column names. Sheets drift — headers get
 * renamed or gain a leading space (`' Stock Confirmation'`) — so the analysis
 * reads by priority list instead of a single hardcoded name.
 */
function pick(row: Record<string, any>, ...names: string[]): any {
  for (const n of names) {
    const v = row[n];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

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
    const dateField = row.Date || row.Timestamp || row['Scheduled Date'] || row['Dispatch Date'];
    if (!dateField) return true;
    const d = parseSheetDate(dateField);
    if (!d) return true;
    const rTime = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return rTime >= sTime && rTime <= eTime;
  });
}

interface Warning { sNo: string; company: string; field: string; issue: string; severity: 'critical' | 'warning'; }

function auditWarnings(rows: ScanRecord[]): Warning[] {
  const warnings: Warning[] = [];
  rows.forEach((row: any) => {
    const sNo = pick(row, 'S.No.') || 'N/A';
    const company = pick(row, 'Company Name', 'Company') || 'Unknown Company';

    const transporter = pick(row, 'Transporter Name', 'Transporter', 'Transport');
    if (!transporter) {
      warnings.push({ sNo, company, field: 'Transporter Logistics', issue: 'Transporter name is blank.', severity: 'warning' });
    }
    const mailId = pick(row, 'Mail ID', 'Email');
    if (!mailId) {
      warnings.push({ sNo, company, field: 'Mail ID', issue: 'No client email address present.', severity: 'warning' });
    }

    const remarksStr = String(pick(row, 'Remarks') || '').toUpperCase();
    const hasDeliveredRemark = remarksStr.includes('DELIVERED') || remarksStr.includes('DELIVER');
    const deliveryDateEmpty = !pick(row, 'Delivery Date to Client');
    if (hasDeliveredRemark && deliveryDateEmpty) {
      warnings.push({ sNo, company, field: 'Delivery Date to Client', issue: "Remarks state 'DELIVERED', but the actual 'Delivery Date to Client' field is empty.", severity: 'critical' });
    }

    const isDispatchedStatus = String(pick(row, 'Delivery Status', 'On Time Status') || '').toLowerCase() === 'dispatched';
    const dispatchDateEmpty = !pick(row, 'Dispatch Date');
    if (isDispatchedStatus && dispatchDateEmpty) {
      warnings.push({ sNo, company, field: 'Dispatch Date', issue: "Delivery Status is 'Dispatched', but no 'Dispatch Date' is recorded.", severity: 'critical' });
    }

    const isDelayedBUI = String(pick(row, 'On Time Status-BUI', 'On Time Status') || '').toLowerCase() === 'delayed';
    const tentativeDateEmpty = !pick(row, 'Tentative Delivery Date BUI', 'Tentative Delivery Date');
    if (isDelayedBUI && tentativeDateEmpty) {
      warnings.push({ sNo, company, field: 'Tentative Delivery Date BUI', issue: "Order is marked as 'Delayed' by BUI, but no 'Tentative Delivery Date BUI' is specified.", severity: 'warning' });
    }

    const orderDate = parseSheetDate(row.Date);
    const confirmDate = parseSheetDate(pick(row, 'Stock Confirmation Date', 'Client/Stock Confirmation Date'));
    const dispatchDate = parseSheetDate(pick(row, 'Dispatch Date'));
    const deliveryDate = parseSheetDate(pick(row, 'Delivery Date to Client'));

    if (orderDate && dispatchDate && dispatchDate < orderDate) {
      warnings.push({ sNo, company, field: 'Dispatch Date', issue: `Dispatch date (${pick(row, 'Dispatch Date')}) is earlier than the order date (${row.Date}).`, severity: 'critical' });
    }
    if (dispatchDate && deliveryDate && deliveryDate < dispatchDate) {
      warnings.push({ sNo, company, field: 'Delivery Date to Client', issue: `Delivery date (${pick(row, 'Delivery Date to Client')}) is earlier than the dispatch date (${pick(row, 'Dispatch Date')}).`, severity: 'critical' });
    }
    if (confirmDate && dispatchDate && dispatchDate < confirmDate) {
      warnings.push({ sNo, company, field: 'Dispatch Date', issue: `Dispatch date (${pick(row, 'Dispatch Date')}) is earlier than the Client Confirmation date (${pick(row, 'Stock Confirmation Date', 'Client/Stock Confirmation Date')}).`, severity: 'critical' });
    }

    if (!pick(row, 'SO Number')) {
      warnings.push({ sNo, company, field: 'SO Number', issue: 'Sales Order (SO) Number is blank.', severity: 'warning' });
    }

    const isConfirmed = String(pick(row, 'Client Confirmation') || '').toLowerCase() === 'yes';
    const confirmDateEmpty = !pick(row, 'Stock Confirmation Date', 'Client/Stock Confirmation Date');
    if (isConfirmed && confirmDateEmpty) {
      warnings.push({ sNo, company, field: 'Client/Stock Confirmation Date', issue: "Client Confirmation is 'Yes', but no confirmation date is recorded.", severity: 'warning' });
    }

    const amount = getSOAmount(row);
    if (amount <= 0) {
      warnings.push({ sNo, company, field: 'Amount', issue: 'Order amount is empty or zero.', severity: 'warning' });
    }

    const due = parseFloat(String(pick(row, 'Payment Due') || '0').replace(/[^0-9.]/g, '')) || 0;
    if (due > 0 && !pick(row, 'Payment Status')) {
      warnings.push({ sNo, company, field: 'Payment Status', issue: `Payment of ₹${due.toLocaleString()} is due, but payment status is blank.`, severity: 'critical' });
    }
  });
  return warnings;
}

function buildDashboard(rows: ScanRecord[]): any {
  const today = new Date();
  let totalVal = 0;
  let delayedCount = 0;
  let overdueExpectedCount = 0;
  let availableCount = 0;

  const orderValueByCompany: Record<string, number> = {};
  const stockDistribution: Record<string, number> = {};

  rows.forEach((row: any) => {
    const amt = getSOAmount(row);
    totalVal += amt;
    const company = String(pick(row, 'Company Name', 'Company') || 'Unknown');
    orderValueByCompany[company] = (orderValueByCompany[company] || 0) + amt;

    const stock = String(pick(row, ' Stock Confirmation', 'Stock Confirmation') || 'Unknown');
    stockDistribution[stock] = (stockDistribution[stock] || 0) + 1;
    if (stock === 'Available') availableCount++;

    const status = String(pick(row, 'On Time Status-BUI', 'On Time Status') || '').toLowerCase();
    const isDelayed = status.includes('delayed');
    if (isDelayed) delayedCount++;

    const sched = parseSheetDate(pick(row, 'Scheduled Date'));
    const tent = parseSheetDate(pick(row, 'Tentative Delivery Date BUI', 'Tentative Delivery Date'));
    const remarkDates = parseRemarkDates(pick(row, 'Remarks'));
    const hasFutureExpectedDate = (tent && tent > today) || remarkDates.some((rd) => rd > today);
    const wasScheduledInPast = sched && sched < today;
    if (isDelayed && wasScheduledInPast && hasFutureExpectedDate) overdueExpectedCount++;
  });

  const dispatchLog = rows.map((row: any) => [
    pick(row, 'S.No.'),
    pick(row, 'Date'),
    pick(row, 'SO Number'),
    pick(row, 'Company Name', 'Company'),
    pick(row, 'Amount'),
    pick(row, 'Transporter Name', 'Transporter', 'Transport'),
    pick(row, ' Stock Confirmation', 'Stock Confirmation'),
    pick(row, 'Stock Confirmation Date'),
  ]);

  return {
    kpis: [
      { label: 'Total Dispatch Value', value: `₹${totalVal.toLocaleString('en-IN')}`, sub: 'Sum of active dispatch order amounts', accent: 'indigo' },
      { label: 'Dispatch Delays', value: `${delayedCount} Delayed`, sub: 'Dispatches currently marked as delayed', accent: 'rose' },
      { label: 'Overdue & Rescheduled', value: `${overdueExpectedCount} Overdue & expected in future`, sub: 'Delayed dispatches expected after today', accent: 'amber' },
      { label: 'Stock Readiness', value: `${availableCount} Ready / ${rows.length} Total`, sub: 'Fully available stock dispatches', accent: 'emerald' },
    ],
    warnings: auditWarnings(rows),
    tables: [
      {
        title: 'Order Value by Company',
        columns: ['Company Name', 'Order Amount (INR)'],
        rows: Object.entries(orderValueByCompany).sort((a, b) => b[1] - a[1]).map(([company, amt]) => [company, amt]),
      },
      {
        title: 'Stock Confirmation Distribution',
        columns: ['Stock Confirmation', 'Orders'],
        rows: Object.entries(stockDistribution).map(([stock, count]) => [stock, count]),
      },
      {
        title: 'Dispatch Log',
        columns: ['S.No.', 'Date', 'SO Number', 'Company Name', 'Amount', 'Transporter Name', 'Stock Confirmation', 'Stock Confirmation Date'],
        rows: dispatchLog,
      },
    ],
  };
}

export async function handler(ctx: AutomationContext): Promise<void> {
  const sheetUrl = String(ctx.config.sheetUrl ?? '');
  const range = String(ctx.config.range ?? 'A1:Z1000');
  const result = await GoogleSheetsService.getSpreadsheetData(sheetUrl, range);
  if (!result.configured) {
    ctx.log('warn', 'Dispatch sheet scan skipped: Google Sheets not configured', {});
    return;
  }
  const dash = buildDashboard(result.rows);
  ctx.log('info', 'Dispatch sheet scan complete', {
    rows: result.rows.length,
    delays: dash.kpis[1].value,
    warnings: dash.warnings.length,
  });
}

export async function data(ctx: AutomationContext): Promise<any> {
  const sheetUrl = String(ctx.config.sheetUrl ?? '');
  const range = String(ctx.config.range ?? 'A1:Z1000');
  const result = await GoogleSheetsService.getSpreadsheetData(sheetUrl, range);
  const rows = filterByDate(result.rows ?? [], ctx);
  const dash = buildDashboard(rows);
  return {
    meta: {
      analysis: 'sheet',
      title: 'Dispatch & CRM Tracker',
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
