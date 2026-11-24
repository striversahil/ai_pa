// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/schema-catalog.ts — which live tables the AI prompt
// should see, and how the block reads (PURE).
//
// Names come from `sqlite_master` at runtime (never hardcoded), so a renamed
// table can't make the copied schema lie — this file only decides ORDER and
// HINTS. Business tables first (call log, people, estimates, orders, money),
// infra tables (audit/auth/notification) after, everything else skipped: 186
// tables would blow past any agent's context for no benefit.
// ─────────────────────────────────────────────────────────────────────────────

export interface SchemaTable {
  table: string;
  note: string;
  columns: Array<{ name: string; type: string }>;
}

const PRIORITY = [
  'DeviceCall',
  'Telecaller',
  'HumanResourcesMember',
  'SalesOrder',
  'Estimate',
  'Enquiry',
  'Customer',
];

/** Prefixes worth exposing. `core_`/`hlp_` carry platform truth, the rest are
 *  the business tables a founder actually escalates on. */
const PREFIXES = [
  'DeviceCall',
  'Telecaller',
  'HumanResources',
  'SalesOrder',
  'Estimate',
  'Enquiry',
  'Customer',
  'Payment',
  'Debtors',
  'Stock',
  'Vendor',
  'Audit',
  'auth_',
  'core_',
  'hlp_',
  'Neodove',
  'Sales',
];

const SKIP = [/^sqlite_/i, /^_cf_/i, /^d1_/i, /^__/];

const NOTES: Record<string, string> = {
  DeviceCall: 'Auto-dialer + phone call log: one row per attempt (attemptAt ISO UTC, status CONNECTED/…, telecallerId).',
  Telecaller: 'Sales roster: region, type (telecaller/team_lead), neodoveUserId. Join to people by email.',
  HumanResourcesMember: 'Employees: name, designation (= chart position), department, active. This is the notification target.',
  SalesOrder: 'Sales order header (region, lifecycle, due dates).',
  Estimate: 'Zoho estimate header: region, rateStatus, dates, amount.',
  Enquiry: 'Enquiry pipeline header.',
  Customer: 'Customer master: region/state/district, type, tags.',
  Payment: 'Payment/receivable tables (dues, statements).',
  auth_user: 'Logins (email). Roles/scopes live in auth_user_role / auth_role.',
  core_notification: 'The inbox the bell renders (written only by notifyUsers).',
};

export function pickTables(names: string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = String(raw ?? '');
    if (!name || SKIP.some((re) => re.test(name))) continue;
    if (!PREFIXES.some((p) => name.toLowerCase().startsWith(p.toLowerCase()))) continue;
    out.push(name);
  }
  const rank = (t: string) => {
    const i = PRIORITY.indexOf(t);
    return i === -1 ? PRIORITY.length : i;
  };
  return out.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, 45);
}

export function tableNote(table: string): string {
  if (NOTES[table]) return NOTES[table];
  const hit = Object.keys(NOTES).find((k) => table.toLowerCase().startsWith(k.toLowerCase()));
  return hit ? NOTES[hit] : '';
}

/** The copyable block: one line per table with every column and its affinity.
 *  Deliberately chat-friendly (no markdown tables, no indentation traps). */
export function schemaText(tables: SchemaTable[]): string {
  const lines: string[] = ['D1 (SQLite) schema — Founder OS. Columns: name TYPE.'];
  for (const t of tables) {
    lines.push('');
    lines.push(`${t.table}${t.note ? `  -- ${t.note}` : ''}`);
    for (const c of t.columns) lines.push(`  ${c.name} ${c.type || 'TEXT'}`);
  }
  return lines.join('\n');
}
