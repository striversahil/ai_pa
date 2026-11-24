// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/schema-catalog.ts — which live tables the AI prompt
// should see, how the block reads, and how tables CONNECT (PURE).
//
// Names come from `sqlite_master` at runtime (never hardcoded), so a renamed
// table can't make the copied schema lie — the table/column lists are always
// the DB's; this file only decides ORDER, HINTS and the relationship edges.
//
// Why relationships (founder, 2026-11-24): a flat column dump let an agent
// invent joins and columns. Every table now carries its outgoing edges with a
// confidence label, so the agent joins along a declared relationship instead of
// guessing:
//   fk       — real SQLite `REFERENCES` in a migration (strongest, checked by the DB)
//   orm      — a join our code performs at runtime (d1-prisma RELATIONS)
//   declared — Prisma `@relation(fields: …, references: …)` intent
//   app      — no key exists; the application joins these values (email bridges)
//   inferred — column name looks like a key to an existing table (weakest)
// ─────────────────────────────────────────────────────────────────────────────

export type JoinKind = 'fk' | 'orm' | 'declared' | 'app' | 'inferred';

export interface TableJoin {
  /** Column on the owning table. */
  field: string;
  /** Table it points at. */
  model: string;
  /** Column on `model`. */
  ref: string;
  kind: JoinKind;
}

export interface AppJoin extends TableJoin {
  from: string;
  /** Why the join exists (shown to the agent, not machine-parsed). */
  why?: string;
}

export interface SchemaTable {
  table: string;
  note: string;
  columns: Array<{ name: string; type: string }>;
  /** Outgoing edges — how this table connects to the rest of the model. */
  joins?: TableJoin[];
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
  hlp_notification_delivery: 'Per-notification level/colour/metric sidecar (ruleKey + windowKey dedupe).',
  hlp_notification_rule: 'Authored escalation rules (audience + cadence + metric SQL).',
};

/**
 * Joins the application performs WITHOUT a foreign key. These are the ones a
 * SQL author gets wrong most often, so they are stated explicitly.
 * Verified against: modules/notifications/targets.ts (seat identity),
 * modules/org/read.ts (login ↔ employee), modules/core/notify.ts (inbox).
 */
export const APPLICATION_JOINS: readonly AppJoin[] = [
  { from: 'Telecaller', field: 'email', model: 'HumanResourcesMember', ref: 'email', kind: 'app', why: 'roster → employee (seat identity for notifications)' },
  { from: 'HumanResourcesMember', field: 'email', model: 'Telecaller', ref: 'email', kind: 'app', why: 'employee → roster (region/type)' },
  { from: 'HumanResourcesMember', field: 'email', model: 'auth_user', ref: 'email', kind: 'app', why: 'employee → login (roles/scopes)' },
  { from: 'HumanResourcesMember', field: 'loginEmail', model: 'auth_user', ref: 'email', kind: 'app', why: 'alternate login email' },
  { from: 'core_notification', field: 'employeeId', model: 'HumanResourcesMember', ref: 'id', kind: 'app', why: 'inbox row → recipient' },
  { from: 'hlp_notification_delivery', field: 'notificationId', model: 'core_notification', ref: 'id', kind: 'app', why: 'sidecar → inbox row' },
  { from: 'hlp_notification_delivery', field: 'employeeKey', model: 'HumanResourcesMember', ref: 'id', kind: 'app', why: 'sidecar → recipient' },
  { from: 'hlp_notification_delivery', field: 'ruleKey', model: 'hlp_notification_rule', ref: 'key', kind: 'app', why: 'sidecar → rule' },
];

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

/** Curated no-FK edges for one table. */
export function applicationJoinsFor(table: string): TableJoin[] {
  return APPLICATION_JOINS.filter((j) => j.from === table).map(({ field, model, ref, kind }) => ({ field, model, ref, kind }));
}

/**
 * Weakest tier: a column that ends in `Id`/`_id` whose base names a table we
 * already expose. Cheap, usually right, and always labelled `inferred` so the
 * agent knows to verify it with Test.
 */
export function inferJoins(table: string, columns: string[], tables: string[]): TableJoin[] {
  const byLower = new Map(tables.map((t) => [t.toLowerCase(), t]));
  const out: TableJoin[] = [];
  for (const col of columns) {
    const m = String(col).match(/^(.+?)(?:Id|_id)$/);
    if (!m) continue;
    const base = m[1].replace(/_+$/, '').toLowerCase();
    if (!base || base === 'id') continue;
    const target = byLower.get(base) ?? byLower.get(`${base}s`) ?? byLower.get(`${base}es`) ?? byLower.get(base.replace(/s$/, ''));
    if (!target || target === table) continue;
    out.push({ field: col, model: target, ref: 'id', kind: 'inferred' });
  }
  return out;
}

const KIND_ORDER: Record<JoinKind, number> = { fk: 0, orm: 1, declared: 2, app: 3, inferred: 4 };

/** Merge + dedupe edges by (field, model), strongest kind first. */
export function mergeJoins(...groups: TableJoin[][]): TableJoin[] {
  const seen = new Map<string, TableJoin>();
  for (const group of groups) {
    for (const j of group ?? []) {
      if (!j?.field || !j?.model) continue;
      const key = `${j.field}->${j.model}`;
      const prev = seen.get(key);
      if (!prev || KIND_ORDER[j.kind] < KIND_ORDER[prev.kind]) seen.set(key, j);
    }
  }
  return [...seen.values()].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.field.localeCompare(b.field),
  );
}

/** The copyable block: tables, their columns, and their outgoing joins.
 *  Deliberately chat-friendly (no markdown tables, no indentation traps). */
export function schemaText(tables: SchemaTable[]): string {
  const lines: string[] = [
    'D1 (SQLite) schema — Founder OS. Columns: name TYPE.',
    'Edges: `->` = joinable, labelled fk | orm | declared | app | inferred (strongest first).',
  ];
  for (const t of tables) {
    lines.push('');
    lines.push(`${t.table}${t.note ? `  -- ${t.note}` : ''}`);
    for (const c of t.columns) lines.push(`  ${c.name} ${c.type || 'TEXT'}`);
    for (const j of t.joins ?? []) lines.push(`  -> ${j.field} = ${j.model}.${j.ref}   (${j.kind})`);
  }
  const appOnly = APPLICATION_JOINS.filter((j) => !tables.some((t) => t.table === j.from && (t.joins ?? []).some((x) => x.field === j.field && x.model === j.model)));
  if (appOnly.length > 0) {
    lines.push('');
    lines.push('-- Joins with no foreign key (enforced by the application, not the DB)');
    for (const j of appOnly) lines.push(`${j.from}.${j.field} = ${j.model}.${j.ref}${j.why ? `   -- ${j.why}` : ''}`);
  }
  return lines.join('\n');
}
