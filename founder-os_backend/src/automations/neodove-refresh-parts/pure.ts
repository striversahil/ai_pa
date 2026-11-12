// Extracted verbatim from neodove-refresh.ts by scripts/refactor/split-module.mjs.
// neodove-refresh.ts re-exports everything public here, so existing imports keep working.


export const NEODOVE_API = 'https://connect.neodove.com/api/v3';

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
export function istRangeStrings(dateStr: string): { startDate: string; endDate: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const prefix = `${DAYS[dt.getUTCDay()]} ${MONTHS[dt.getUTCMonth()]} ${d} ${y}`;
  const tz = 'GMT+0530 (India Standard Time)';
  return { startDate: `${prefix} 00:00:00 ${tz}`, endDate: `${prefix} 23:59:59 ${tz}` };
}

export function rowDateStr(r: any): string {
  const raw = r.dateString || r.date || '';
  return String(raw).slice(0, 10);
}

// IST day → epoch-ms range (NeoDove get-leads expects lead_date_created in ms).
// IST midnight = 18:30 UTC of the previous day; span a full 24h window.
export function istDayEpochRange(dateStr: string): { start: number; end: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d - 1, 18, 30, 0);
  return { start, end: start + 24 * 3600 * 1000 - 1 };
}

export const NEODOVE_PIPELINE_ID = '6960ffd81688fef4bc4df09a';

// Pipeline stage that defines a "generated" lead in the portal counter.
export const NEODOVE_LEAD_STAGE_ID = '3ce47616-4c90-4564-b7a9-66e8a0d35f2d';

export function normalizeRow(r: any, leadsGenerated = 0) {
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
