/**
 * Generate the Accounts seed module + seed migration from the source of truth:
 *   founder-os_backend/data/accounts_follow_up.json
 *
 * Outputs:
 *   src/automations/accounts/seed-tasks.ts      (fresh-DB fallback seeding)
 *   migrations/0032_accounts_tasks_seed.sql     (DELETE placeholders + INSERT 37)
 *
 * Run: node scripts/gen-accounts-seed.mjs
 * Re-run whenever the JSON changes, then apply the migration + redeploy.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = JSON.parse(readFileSync(join(root, 'data/accounts_follow_up.json'), 'utf8'));

// ── Validate the file against its own contract ─────────────────────────────
if (src.schema_version !== '1.0') {
  throw new Error(`accounts_follow_up.json: unsupported schema_version ${JSON.stringify(src.schema_version)} (generator handles 1.0)`);
}
const legendTypes = new Set(Object.keys(src.date_type_legend || {}));
if (!Array.isArray(src.tasks) || src.tasks.length === 0) {
  throw new Error('accounts_follow_up.json: tasks must be a non-empty array');
}
for (const t of src.tasks) {
  if (typeof t.row_number !== 'number') throw new Error(`task missing numeric row_number: ${JSON.stringify(t).slice(0, 80)}`);
  if (!t.task || typeof t.task !== 'string') throw new Error(`row ${t.row_number}: task text required`);
  const et = t.expected_completion?.type;
  if (!et || !legendTypes.has(et)) {
    throw new Error(`row ${t.row_number}: expected_completion.type ${JSON.stringify(et)} not in date_type_legend`);
  }
}

const MONTH_NUM = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const WEEKDAY_NUM = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

function normFrequency(f, ruleType) {
  const v = String(f || '').trim().toLowerCase();
  if (v === 'daily') return 'daily';
  if (v === 'weekly') return 'weekly';
  if (v === 'monthly') return 'monthly';
  if (v === 'quarterly') return 'quarterly';
  if (v === 'yearly') return 'yearly';
  // "Daliy" typo (row 26) carries a multiple_days monthly rule.
  if (v === 'daliy') return 'monthly';
  if (ruleType === 'weekday') return 'weekly';
  if (ruleType === 'multi_occurrence') return 'quarterly';
  if (['fixed_day', 'day_range', 'multiple_days', 'variable_per_item'].includes(ruleType)) return 'monthly';
  if (['week_of_month', 'month_day_range'].includes(ruleType)) return 'yearly';
  return 'monthly';
}

function ownerRole(assignedTo) {
  const s = new Set((assignedTo || []).map((x) => String(x).toLowerCase()));
  const hasSenior = [...s].some((x) => x.includes('senior'));
  const hasJunior = [...s].some((x) => x.includes('junior'));
  if (hasSenior && hasJunior) return 'either';
  if (hasSenior) return 'senior';
  if (hasJunior) return 'junior';
  return 'either'; // unassigned rows (e.g. EMI House) land in both tabs
}

function legacyDue(rule, frequency) {
  let dueDay = null;
  let dueMonth = null;
  if (!rule) return { dueDay, dueMonth };
  if (rule.type === 'fixed_day') {
    dueDay = rule.day ?? null;
    if (rule.month) dueMonth = MONTH_NUM[String(rule.month).toLowerCase()] ?? null;
  } else if (rule.type === 'day_range') {
    dueDay = rule.start_day ?? null;
    if (rule.month) dueMonth = MONTH_NUM[String(rule.month).toLowerCase()] ?? null;
  } else if (rule.type === 'multiple_days') {
    dueDay = rule.days?.[0] ?? null;
    if (rule.month) dueMonth = MONTH_NUM[String(rule.month).toLowerCase()] ?? null;
  } else if (rule.type === 'weekday' && frequency === 'weekly') {
    dueDay = WEEKDAY_NUM[String(rule.weekday || '').toLowerCase()] ?? null;
  }
  return { dueDay, dueMonth };
}

const rows = [];
for (const t of src.tasks) {
  const exp = t.expected_completion || {};
  let ruleType = exp.type || 'to_be_decided';
  let rule = { ...exp };
  delete rule.raw_text;
  const rawText = exp.raw_text ?? null;

  // Row 30: typed to_be_decided but the raw text names explicit days.
  if (t.row_number === 30 && ruleType === 'to_be_decided') {
    ruleType = 'multiple_days';
    rule = { type: 'multiple_days', days: [10, 20, 30], month: null };
  }

  let frequency = normFrequency(t.frequency, ruleType);
  // Row 30's JSON frequency says Weekly but it is really 3 fixed days a month.
  if (t.row_number === 30) frequency = 'monthly';
  const role = ownerRole(t.assigned_to);
  const { dueDay, dueMonth } = legacyDue(ruleType === exp.type ? rule : { ...rule, type: ruleType }, frequency);

  rows.push({
    id: `seed-${String(t.row_number).padStart(2, '0')}`,
    title: t.task,
    description: null,
    frequency,
    ownerRole: role,
    dueDay,
    dueMonth,
    ruleType,
    ruleJson: JSON.stringify(rule),
    rawText,
    // Verbatim sheet fidelity — every per-task JSON field is catered.
    isShared: t.is_shared_task === true,
    employeeRaw: t.employee_raw ?? null,
    department: t.department ?? null,
    sheetStatus: t.status ?? null,
    active: true,
    order: t.row_number,
  });
}

// ── 1. TS seed module ────────────────────────────────────────────────────────
const ts = `/**
 * GENERATED by scripts/gen-accounts-seed.mjs from data/accounts_follow_up.json.
 * Do not hand-edit — re-run the generator. Fresh-DB fallback seed used by
 * ensureSeedTemplates() (the live seed lives in migrations/0032).
 */
export interface AccountsSeedTask {
  id: string;
  title: string;
  description: string | null;
  frequency: string;
  ownerRole: string;
  dueDay: number | null;
  dueMonth: number | null;
  ruleType: string;
  ruleJson: string;
  rawText: string | null;
  isShared: boolean;
  employeeRaw: string | null;
  department: string | null;
  sheetStatus: string | null;
  active: boolean;
  order: number;
}

export const SEED_TASKS: AccountsSeedTask[] = ${JSON.stringify(rows, null, 2)};
`;
writeFileSync(join(root, 'src/automations/accounts/seed-tasks.ts'), ts);

// ── 2. Seed migration SQL ────────────────────────────────────────────────────
// NOTE: keeps the original 0032 column list on purpose — the sheet-fidelity
// columns land in 0034 (ALTER + backfill), so this file applies cleanly both
// on live DBs (already ran) and fresh DBs (0034 runs right after).
const esc = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (v === null || v === undefined ? 'NULL' : String(v));
const bool = (v) => (v ? '1' : '0');
const cols = '("id", "title", "description", "frequency", "ownerRole", "dueDay", "dueMonth", "ruleType", "ruleJson", "rawText", "active", "order", "createdAt", "updatedAt")';
const lines = [
  '-- GENERATED by scripts/gen-accounts-seed.mjs — do not hand-edit.',
  '-- Fresh start for the real follow-up list: drop placeholder templates/logs.',
  'DELETE FROM "AccountsTaskLog";',
  'DELETE FROM "AccountsTaskTemplate";',
  ...rows.map(
    (r) =>
      `INSERT INTO "AccountsTaskTemplate" ${cols} VALUES (${esc(r.id)}, ${esc(r.title)}, ${esc(r.description)}, ${esc(r.frequency)}, ${esc(r.ownerRole)}, ${num(r.dueDay)}, ${num(r.dueMonth)}, ${esc(r.ruleType)}, ${esc(r.ruleJson)}, ${esc(r.rawText)}, 1, ${r.order}, datetime('now'), datetime('now'));`,
  ),
];
writeFileSync(join(root, 'migrations/0032_accounts_tasks_seed.sql'), lines.join('\n') + '\n');

// ── 3. Metadata backfill migration (ALTERs + UPDATEs for live DBs) ──────────
// 0032 predates the sheet-fidelity columns, so live DBs need both the columns
// and the values. Re-runnable: ALTERs are additive, UPDATEs are idempotent.
const backfill = [
  '-- GENERATED by scripts/gen-accounts-seed.mjs — do not hand-edit.',
  '-- Sheet-fidelity columns (is_shared_task / employee_raw / department / status).',
  'ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "isShared" INTEGER NOT NULL DEFAULT 0;',
  'ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "employeeRaw" TEXT;',
  'ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "department" TEXT;',
  'ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "sheetStatus" TEXT;',
  ...rows.map(
    (r) =>
      `UPDATE "AccountsTaskTemplate" SET "isShared" = ${bool(r.isShared)}, "employeeRaw" = ${esc(r.employeeRaw)}, "department" = ${esc(r.department)}, "sheetStatus" = ${esc(r.sheetStatus)} WHERE "id" = ${esc(r.id)};`,
  ),
];
writeFileSync(join(root, 'migrations/0034_accounts_sheet_metadata.sql'), backfill.join('\n') + '\n');

console.log(`wrote seed-tasks.ts + 0032 migration (${rows.length} tasks)`);
const byFreq = {};
for (const r of rows) byFreq[r.frequency] = (byFreq[r.frequency] || 0) + 1;
console.log('by frequency:', JSON.stringify(byFreq));
