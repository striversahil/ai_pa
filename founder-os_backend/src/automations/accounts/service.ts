import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { cached, cacheDel } from '../../shared/cache';
import { mirrorRosterRow } from '../../modules/core/sync';

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
export const OWNER_ROLES = ['senior', 'junior', 'either'] as const;
/** Payment-due categories (kind='payment' templates only). */
export const PAYMENT_CATEGORIES = [
  'Credit Card', 'Mobile Recharge', 'Utilities', 'Loan / EMI', 'Insurance',
  'Rent', 'Software / Subscription', 'Tax / Compliance', 'Other',
] as const;
// Per-day workflow: pending → done, or pending → not_done (explicitly conceded
// with a reason + owner). `inprogress` / `skipped` / `overdue` are legacy (old
// UI offered inprogress; rollover once materialised overdue). Tasks never carry
// over: anything not done by EOD stays on its own day as "not done" and
// surfaces in the Incomplete tab. Past rows are never rewritten.
export const LOG_STATUSES = ['pending', 'inprogress', 'done', 'skipped', 'not_done'] as const;

const DATA_TTL_MS = 5 * 60 * 1000;
// v2: payload rows for shared templates split per lane (slot). Bump on any
// dashboard-shape change so stale KV never serves the old row layout.
const DATA_CACHE_PREFIX = 'accounts:dashboard:v2:';

/** Lane slots for AccountsTaskLog rows. Shared templates get one instance per
 *  lane so each lane completes its own copy; ordinary tasks use 'main'. */
export const SLOT_MAIN = 'main';
export const SLOT_SENIOR = 'senior';
export const SLOT_JUNIOR = 'junior';
export const LANE_SLOTS = [SLOT_SENIOR, SLOT_JUNIOR] as const;

export function slotsFor(t: any): string[] {
  return t?.isShared ? [SLOT_SENIOR, SLOT_JUNIOR] : [SLOT_MAIN];
}

export function slotKey(templateId: unknown, slot: unknown): string {
  return `${String(templateId)}::${String(slot ?? SLOT_MAIN)}`;
}

export function istDateStr(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d).slice(0, 10);
}

function parseDay(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

function fmtDay(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ── Schedule grammar (see data/accounts_follow_up.json `date_type_legend`) ──
const MONTH_NUM: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const WEEKDAY_NUM: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

/** Rule types that never auto-generate dated instances (shown as reference). */
export const UNSCHEDULED_RULES = new Set(['variable_per_item', 'to_be_decided']);

function monthNum(m: unknown): number | null {
  if (m === null || m === undefined) return null;
  if (typeof m === 'number') return m >= 1 && m <= 12 ? Math.floor(m) : null;
  return MONTH_NUM[String(m).trim().toLowerCase()] ?? null;
}

function occurrenceMatch(occurrence: unknown, d: number, dim: number): boolean {
  const o = String(occurrence || 'every').trim().toLowerCase();
  if (o === 'every') return true;
  if (o === 'first') return d <= 7;
  if (o === 'last') return d + 7 > dim;
  if (o === 'second') return d >= 8 && d <= 14;
  if (o === 'third') return d >= 15 && d <= 21;
  if (o === 'fourth') return d >= 22 && d <= 28;
  if (o === 'fifth') return d >= 29;
  return true;
}

function evalRule(rule: any, y: number, m: number, d: number, wd: number, dim: number, frequency: string): boolean {
  const type = String(rule?.type || '');
  switch (type) {
    case 'not_applicable':
      // Daily tasks run every working day (Mon–Sat; Sunday off).
      return frequency === 'daily' ? wd >= 1 && wd <= 6 : true;
    case 'fixed_day': {
      const mo = monthNum(rule.month);
      const want = Math.min(Number(rule.day ?? 1), dim);
      return mo === null ? d === want : m === mo && d === want;
    }
    case 'day_range': {
      const mo = monthNum(rule.month);
      if (mo !== null && m !== mo) return false;
      return d >= Number(rule.start_day ?? 1) && d <= Math.min(Number(rule.end_day ?? dim), dim);
    }
    case 'multiple_days': {
      const mo = monthNum(rule.month);
      if (mo !== null && m !== mo) return false;
      return (Array.isArray(rule.days) ? rule.days : []).map(Number).includes(d);
    }
    case 'weekday': {
      const want = WEEKDAY_NUM[String(rule.weekday || '').toLowerCase()];
      if (want === undefined || wd !== want) return false;
      return occurrenceMatch(rule.occurrence, d, dim);
    }
    case 'week_of_month': {
      const mo = monthNum(rule.month);
      if (mo === null || m !== mo) return false;
      const n = Number(rule.week_number ?? 1);
      return d >= (n - 1) * 7 + 1 && d <= Math.min(n * 7, dim);
    }
    case 'month_day_range': {
      const s = rule.start || {};
      const e = rule.end || {};
      const sMo = monthNum(s.month);
      const eMo = monthNum(e.month);
      if (sMo === null || eMo === null) return false;
      const cur = m * 100 + d;
      const start = sMo * 100 + Number(s.day ?? 1);
      const end = eMo * 100 + Number(e.day ?? 31);
      return start <= end ? cur >= start && cur <= end : cur >= start || cur <= end;
    }
    case 'multi_occurrence':
      return (Array.isArray(rule.occurrences) ? rule.occurrences : []).some((o: any) =>
        evalRule(o, y, m, d, wd, dim, frequency),
      );
    case 'variable_per_item':
    case 'to_be_decided':
    default:
      return false;
  }
}

function parseRule(t: any): any | null {
  if (!t?.ruleJson) return null;
  try {
    const r = typeof t.ruleJson === 'string' ? JSON.parse(t.ruleJson) : t.ruleJson;
    return r && typeof r === 'object' && r.type ? r : null;
  } catch {
    return null;
  }
}

/** Due date produced by one statement month: statement (day clamped to the
 *  month length) + graceDays. Spills into the next month / year naturally
 *  (e.g. statement Jan 28 + 20d → Feb 17; statement Jan 31 + 20d → Feb 20 —
 *  the "different billing date per card" model). */
export function dueDateForStatement(sy: number, sm: number, statementDay: number, graceDays: number): string | null {
  const s = Math.floor(statementDay);
  const g = Math.floor(graceDays);
  if (!Number.isFinite(s) || s < 1 || s > 31) return null;
  if (!Number.isFinite(g) || g < 1 || g > 60) return null;
  if (!Number.isFinite(sy) || !Number.isFinite(sm) || sm < 1 || sm > 12) return null;
  const stmt = fmtDay(sy, sm, Math.min(s, daysInMonth(sy, sm)));
  return addDays(stmt, g);
}

/** Is `dateStr` a due date under the statement+days model? The grace window
 *  (≤60d) means a due date in month M can come from the statement of M, M-1
 *  or M-2 — check all three back-months. */
function isOffsetDueOn(t: any, y: number, m: number, d: number): boolean {
  const s = Math.floor(Number((t as any)?.statementDay));
  const g = Math.floor(Number((t as any)?.graceDays));
  if (!Number.isFinite(s) || s < 1 || s > 31) return false;
  if (!Number.isFinite(g) || g < 1 || g > 60) return false;
  const want = fmtDay(y, m, d);
  for (let back = 0; back <= 2; back++) {
    let sy = y;
    let sm = m - back;
    while (sm < 1) { sm += 12; sy -= 1; }
    const due = dueDateForStatement(sy, sm, s, g);
    if (due === want) return true;
  }
  return false;
}

/** Legacy path for simple MIS-created tasks (no ruleJson): frequency + dueDay/dueMonth. */
function legacyDueOn(t: any, y: number, m: number, d: number, wd: number, dim: number): boolean {
  const freq = String(t.frequency || 'daily');
  if (freq === 'daily') return wd >= 1 && wd <= 6;
  if (freq === 'weekly') return wd === Number(t.dueDay ?? 4);
  // Credit cards on the statement+days model ignore dueDay entirely — the due
  // date is statementDay + graceDays (may land in the next month).
  if (String((t as any)?.dueMode || 'fixed') === 'after_statement'
    && String((t as any)?.kind || 'task') === 'payment'
    && freq === 'monthly') {
    return isOffsetDueOn(t, y, m, d);
  }
  if (freq === 'monthly') return d === Math.min(Number(t.dueDay ?? 1), dim);
  if (freq === 'quarterly') {
    const qStart = Math.floor((m - 1) / 3) * 3 + 1;
    if (m !== qStart) return false;
    return d === Math.min(Number(t.dueDay ?? 1), dim);
  }
  if (freq === 'yearly') {
    const wm = Number(t.dueMonth ?? 1);
    if (m !== wm) return false;
    return d === Math.min(Number(t.dueDay ?? 1), dim);
  }
  return true;
}

/** Is template `t` due on IST date `dateStr`? */
export function isDueOn(t: any, dateStr: string): boolean {
  const { y, m, d } = parseDay(dateStr);
  const dim = daysInMonth(y, m);
  // Weekday via UTC noon (avoids TZ edge).
  const wd = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  const rule = parseRule(t);
  if (rule) return evalRule(rule, y, m, d, wd, dim, String(t.frequency || 'daily'));
  return legacyDueOn(t, y, m, d, wd, dim);
}

// ── Range-window grace ─────────────────────────────────────────────────────
// Window rules (`day_range`, `month_day_range`, `week_of_month`, or a matching
// window inside `multi_occurrence`) are due EVERY day of a span, and the span —
// not each day — is the deadline. While the window is still open (t is due on
// `dateStr` via a window rule), earlier unresolved days inside the SAME window
// are grace: the card stays plain pending, no red. Only once the last day
// passes do they read incomplete. Single-occasion rules (daily, fixed_day,
// multiple_days, weekday) get no grace — a missed day turns red next day.
/** Rule types whose span (not each day) is the deadline. */
const WINDOW_RULES = new Set(['day_range', 'month_day_range', 'week_of_month']);

function windowMatchToday(rule: any, t: any, y: number, m: number, d: number, wd: number, dim: number): boolean {
  if (!rule || typeof rule !== 'object') return false;
  const type = String(rule.type || '');
  if (type === 'multi_occurrence') {
    return (Array.isArray(rule.occurrences) ? rule.occurrences : []).some((o: any) =>
      windowMatchToday(o, t, y, m, d, wd, dim),
    );
  }
  if (!WINDOW_RULES.has(type)) return false;
  return evalRule(rule, y, m, d, wd, dim, String((t as any)?.frequency || 'daily'));
}

/** Grace-window start (inclusive) for template `t` as of `dateStr`, or null.
 *  Non-null only while the window is still open. Unresolved instance dates in
 *  [start, dateStr) are grace — not misses. */
export function windowGraceStart(t: any, dateStr: string): string | null {
  const rule = parseRule(t);
  if (!rule) return null;
  const { y, m, d } = parseDay(dateStr);
  const dim = daysInMonth(y, m);
  const wd = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  if (!windowMatchToday(rule, t, y, m, d, wd, dim)) return null;
  let start = dateStr;
  let cur = addDays(dateStr, -1);
  for (let i = 0; i < 370 && isDueOn(t, cur); i++) {
    start = cur;
    cur = addDays(cur, -1);
  }
  return start;
}

/** Consecutive-miss streak: trailing run of due-days ending at `anchor`
 *  (inclusive) that are all unresolved — the "N days missed consecutively"
 *  number. Non-due days are skipped (a Sunday never breaks a daily streak);
 *  the first due-but-resolved day ends it. `unresolved` = set of YYYY-MM-DD
 *  dates with open instances. */
export function missStreak(t: any, anchor: string, unresolved: Set<string>): number {
  let n = 0;
  let cur = String(anchor || '').slice(0, 10);
  for (let i = 0; i < 370; i++) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cur)) break;
    if (!isDueOn(t, cur)) { cur = addDays(cur, -1); continue; }
    if (!unresolved.has(cur)) break;
    n++;
    cur = addDays(cur, -1);
  }
  return n;
}

/** Real follow-up list (generated from data/accounts_follow_up.json). */
import { SEED_TASKS } from './seed-tasks';

export async function ensureSeedTemplates(): Promise<void> {
  try {
    const count = await prisma.accountsTaskTemplate.count();
    if (count > 0) return;
    for (const t of SEED_TASKS) {
      await (prisma as any).accountsTaskTemplate.create({ data: { ...(t as any) } });
    }
    logger.info({ n: SEED_TASKS.length }, 'accounts: seeded follow-up templates');
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'accounts: seed failed (best-effort)');
  }
}

/** Ensure one log row per due template for `dateStr` (idempotent). */
export async function ensureInstances(dateStr: string): Promise<number> {
  await ensureSeedTemplates();
  await splitSharedMains();
  const templates = await prisma.accountsTaskTemplate.findMany({ where: { active: true } });
  const due = templates.filter((t: any) => isDueOn(t, dateStr));
  if (due.length === 0) return 0;
  const wanted = new Map<string, { t: any; slot: string }>();
  for (const t of due as any[]) {
    for (const slot of slotsFor(t)) wanted.set(slotKey((t as any).id, slot), { t, slot });
  }
  const existing = await prisma.accountsTaskLog.findMany({
    where: { dueDate: dateStr, templateId: { in: due.map((t: any) => t.id) } },
    select: { templateId: true, slot: true },
  });
  const have = new Set((existing as any[]).map((r) => slotKey(r.templateId, r.slot)));
  const missing = [...wanted.entries()].filter(([k]) => !have.has(k));
  if (missing.length === 0) return 0;
  // One batched INSERT + one re-read (2 round trips total). Unique
  // (templateId, dueDate, slot) keeps concurrent rollovers idempotent — on
  // conflict the batch throws and we fall back to idempotent per-row creates.
  try {
    const rows = await (prisma as any).accountsTaskLog.createManyAndReturn({
      data: missing.map(([, { t, slot }]) => ({ templateId: String(t.id), dueDate: dateStr, slot, status: 'pending' })),
    });
    return Array.isArray(rows) ? rows.length : missing.length;
  } catch {
    const results = await Promise.all(missing.map(async ([, { t, slot }]) => {
      try {
        await prisma.accountsTaskLog.create({ data: { templateId: t.id, dueDate: dateStr, slot, status: 'pending' } });
        return 1;
      } catch { return 0; /* unique race — ignore */ }
    }));
    return results.reduce<number>((a, b) => a + b, 0);
  }
}

/**
 * One-time-per-row backfill for the shared-slot change (migration 0042):
 * shared templates whose instance is still the legacy slot='main' get one
 * copy per lane and the main row is removed (its proof files are duplicated
 * onto the copies — metadata only, bytes shared via the same KV key).
 * A Done stays done ONLY in the lane of whoever did it (roster-matched via
 * accountantId, else doneBy-name); the other lane restarts as pending with a
 * clean slate. Idempotent — no-ops when no shared mains remain.
 */
export async function splitSharedMains(): Promise<number> {
  const mains = await (prisma as any).accountsTaskLog.findMany({
    where: { slot: SLOT_MAIN },
    include: { template: true },
  }).catch(() => []);
  const shared = (mains as any[]).filter((l) => !!l?.template?.isShared);
  if (!shared.length) return 0;
  const roster = (await prisma.accountant.findMany({ where: { deleted: false } }).catch(() => [])) as any[];
  const laneOf = (accId: unknown, doneBy: unknown): string | null => {
    if (accId) {
      const r = roster.find((x) => String(x.id) === String(accId));
      if (r && (String(r.role) === SLOT_SENIOR || String(r.role) === SLOT_JUNIOR)) return String(r.role);
    }
    const n = normName(doneBy);
    if (n && n.length >= 3) {
      const hits = roster.filter((x) => {
        const rn = normName(x.name);
        return rn && (rn === n || rn.startsWith(n) || n.startsWith(rn));
      });
      if (hits.length === 1) return String(hits[0].role);
    }
    return null;
  };
  let split = 0;
  for (const m of shared) {
    const wasDone = String(m.status) === 'done';
    const doneLane = wasDone ? (laneOf(m.accountantId, m.doneBy) ?? SLOT_SENIOR) : null;
    const base = {
      templateId: String(m.templateId),
      dueDate: String(m.dueDate),
      remark: m.remark ?? null,
      timeSpentMin: m.timeSpentMin ?? null,
      updatedBy: m.updatedBy ?? null,
    };
    const copies: any[] = [];
    for (const slot of LANE_SLOTS) {
      const keep = !wasDone || slot === doneLane;
      const row: any = await (prisma as any).accountsTaskLog.create({
        data: {
          ...base,
          slot,
          status: keep ? String(m.status) : 'pending',
          remark: keep ? base.remark : null,
          doneBy: keep ? (m.doneBy ?? null) : null,
          timeSpentMin: keep ? base.timeSpentMin : null,
          accountantId: keep ? (m.accountantId ?? null) : null,
        },
      }).catch(() => null);
      if (!row) break;
      copies.push(row);
    }
    if (copies.length !== LANE_SLOTS.length) continue; // race — leave main for next pass
    const files = await (prisma as any).accountsTaskAttachment.findMany({
      where: { logId: String(m.id) },
    }).catch(() => []);
    for (const target of copies) {
      // Proof belongs to the lane that earned it; open rows share it (same
      // work-in-progress evidence for both lanes).
      if (wasDone && String((target as any).slot) !== doneLane) continue;
      for (const f of files as any[]) {
        await (prisma as any).accountsTaskAttachment.create({
          data: {
            logId: String((target as any).id),
            fileName: f.fileName, mime: f.mime, size: f.size,
            kvKey: f.kvKey, uploadedBy: f.uploadedBy,
          },
        }).catch(() => {});
      }
    }
    await (prisma as any).accountsTaskLog.delete({ where: { id: String(m.id) } }).catch(() => {});
    await (prisma as any).accountsTaskAttachment.deleteMany({ where: { logId: String(m.id) } }).catch(() => {});
    split++;
  }
  if (split) await invalidateAccountsCache();
  return split;
}

/** No-op since the per-day model: past unresolved rows are NOT rewritten.
 *  They stay pending/inprogress on their own day and read as "not done" in
 *  the Incomplete tab. Legacy `overdue` rows (materialised before this
 *  change) are still treated as incomplete at serve time. Kept for the
 *  rollover call-site compat. */
export async function flagOverdue(_todayStr: string): Promise<number> {
  return 0;
}

/**
 * Carryover: unresolved (pending/overdue/inprogress) instances of the given
 * templates from BEFORE `dateStr` (lookback window). The today-only taskbar
 * would otherwise hide a missed window day behind today's fresh instance —
 * this map lets today's row wear a "missed 15th" badge and count as overdue.
 */
export async function getCarriedOverdue(
  templateIds: string[], dateStr: string, lookbackDays = 120,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!templateIds.length) return out;
  const from = addDays(dateStr, -lookbackDays);
  const rows = await (prisma as any).accountsTaskLog.findMany({
    where: {
      templateId: { in: templateIds },
      dueDate: { gte: from, lt: dateStr },
      status: { in: ['pending', 'overdue', 'inprogress', 'not_done'] },
    },
    select: { templateId: true, dueDate: true, slot: true },
    orderBy: { dueDate: 'asc' },
    take: 2000,
  }).catch(() => []);
  for (const r of rows as any[]) {
    const k = slotKey(r.templateId, r.slot);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(String(r.dueDate));
  }
  return out;
}

export async function runDailyRollover(): Promise<{ date: string; created: number; overdue: number }> {
  const today = istDateStr();
  const created = await ensureInstances(today);
  const overdue = await flagOverdue(today);
  await invalidateAccountsCache();
  return { date: today, created, overdue };
}

export async function invalidateAccountsCache(): Promise<void> {
  try { await cacheDel(DATA_CACHE_PREFIX.slice(0, -1)); } catch { /* best-effort */ }
  try {
    const { cacheDelPrefix } = await import('../../shared/cache');
    await cacheDelPrefix(DATA_CACHE_PREFIX);
  } catch { /* older cache module without prefix del */ }
}

async function computeDashboard(
  dateStr: string,
  scope: { scope: LaneScope | null; isAdmin: boolean } | null = null,
) {
  await ensureInstances(dateStr);
  const [roster, allTemplates, logs] = await Promise.all([
    prisma.accountant.findMany({ where: { deleted: false }, orderBy: { order: 'asc' } }),
    prisma.accountsTaskTemplate.findMany({ where: { active: true }, orderBy: { order: 'asc' } }),
    prisma.accountsTaskLog.findMany({
      where: { dueDate: dateStr },
      include: { template: true, accountant: true },
    }),
  ]);
  // Payment dues (kind='payment') live in the Payment dues tab, never in the
  // task lanes — filter them here; getPaymentDues() serves them separately.
  const templates = (allTemplates as any[]).filter((t) => String(t.kind || 'task') !== 'payment');
  const logIds = (logs as any[]).map((l) => String(l.id)).filter(Boolean);
  const attachments = logIds.length
    ? await (prisma as any).accountsTaskAttachment.findMany({
      where: { logId: { in: logIds } },
      orderBy: { createdAt: 'asc' },
    }).catch(() => [])
    : [];
  const bySlot = new Map((logs as any[]).map((l) => [slotKey(l.templateId, l.slot), l]));
  const active = (templates as any[]).filter((t) => !UNSCHEDULED_RULES.has(String(parseRule(t)?.type ?? t.ruleType ?? '')));
  // Lane enforcement: non-MIS viewers only receive their own lane (their role
  // plus shared). Shared templates are visible in BOTH lanes regardless of
  // ownerRole — each lane gets its own slot copy (see slotsFor). Admins, and
  // logged-out callers where the auth gate is off (local/dev), receive
  // everything. Logged-in non-roster viewers receive nothing but the team board.
  const laneRole = scope && !scope.isAdmin ? (scope.scope?.selfRole ?? null) : null;
  const laneEnforced = !!scope && !scope.isAdmin;
  const inLane = (t: any) => !laneEnforced || (laneRole !== null && (t.ownerRole === 'either' || t.ownerRole === laneRole || !!t.isShared));
  // A shared template in the wrong lane renders nothing: lane viewers only
  // ever see their own slot copy (a senior must never see/touch the junior
  // copy, and vice versa — that was the shared-Done bug).
  const inSlot = (t: any, slot: string) => !laneEnforced || !(t as any).isShared || slot === laneRole;
  const dueTemplates = active.filter((t) => inLane(t) && isDueOn(t, dateStr));
  const carried = await getCarriedOverdue(dueTemplates.map((t) => String(t.id)), dateStr);
  // Range grace: while a window is still open, earlier unresolved days inside
  // the same window are grace (plain pending, no red) — strip them from the
  // carryover so neither today's card nor the Incomplete tray counts them.
  const graceByTemplate = new Map<string, string>();
  for (const t of dueTemplates as any[]) {
    const g = windowGraceStart(t, dateStr);
    if (g) graceByTemplate.set(String(t.id), g);
  }
  const carriedEffective = new Map<string, string[]>();
  for (const [k, v] of carried) {
    // Carryover keys are per (template :: slot); grace windows are per template.
    const g = graceByTemplate.get(String(k).split('::')[0]);
    const kept = g ? v.filter((dd) => dd < g) : v;
    if (kept.length) carriedEffective.set(k, kept);
  }
  const filesByLog = new Map<string, any[]>();
  for (const f of attachments as any[]) {
    const k = String(f.logId);
    if (!filesByLog.has(k)) filesByLog.set(k, []);
    filesByLog.get(k)!.push(toAttachmentJson(f));
  }
  // Include due-but-not-yet-instantiated templates defensively.
  // Repeat rule: EVERY due template gets its own fresh entry each day even
  // when an older instance of the same task is still not done — the missed
  // row stays in the Incomplete tab with its own days-missed count, and today
  // always shows as a new entry (never suppressed by the backlog).
  // Day-1 rule: a fresh entry is simply done / not-done — it reads incomplete
  // only after its own day has passed (dueDate < today). Past misses live in
  // the Incomplete tab, never on today's card.
  const toItem = (t: any, log: any, slot: string) => {
      const status = log?.status ?? 'pending';
      const missed = carriedEffective.get(slotKey(t.id, (t as any).isShared ? slot : SLOT_MAIN)) ?? [];
      const pastDue = String(dateStr) < istDateStr();
      const isOverdueRow = status === 'overdue' || status === 'not_done' || ((status === 'pending' || status === 'inprogress') && pastDue);
      return {
        templateId: t.id,
        title: t.title,
        description: t.description,
        frequency: t.frequency,
        ownerRole: t.ownerRole,
        dueDay: t.dueDay,
        dueMonth: t.dueMonth,
        ruleType: t.ruleType ?? parseRule(t)?.type ?? null,
        dueLabel: t.rawText ?? null,
        isShared: !!t.isShared,
        slot,
        employeeRaw: t.employeeRaw ?? null,
        logId: log?.id ?? null,
        status,
        remark: log?.remark ?? null,
        doneBy: log?.doneBy ?? null,
        timeSpentMin: log?.timeSpentMin ?? null,
        accountantId: log?.accountantId ?? null,
        accountantName: log?.accountant?.name ?? null,
        updatedAt: log?.updatedAt ?? null,
        attachments: log ? (filesByLog.get(String(log.id)) ?? []) : [],
        // Missed earlier window days (carryover) + stale legacy rows.
        missed,
        overdue: isOverdueRow,
        incomplete: isOverdueRow,
        // Consecutive-miss count is filled by the streak pass below (needs the
        // tray's unresolved-day sets, fetched after this loop).
        daysOverdue: 0,
        daysIncomplete: 0,
      };
    };
  const items = dueTemplates
    .flatMap((t) => {
      // Shared templates render once per lane, each bound to its own slot
      // copy — a Done in one lane can never flip the other lane's card.
      const slots = (t as any).isShared ? [...LANE_SLOTS] : [SLOT_MAIN];
      return slots
        .filter((slot) => inSlot(t, slot))
        .map((slot) => toItem(t, bySlot.get(slotKey((t as any).id, slot)), slot));
    });
  const OPEN = new Set(['pending', 'inprogress', 'overdue', 'not_done']);
  const overdueCount = items.filter((i) => i.overdue && i.status !== 'done' && i.status !== 'skipped').length;
  const openCount = items.filter((i) => OPEN.has(i.status)).length;
  const inProgressCount = items.filter((i) => i.status === 'inprogress').length;
  const doneCount = items.filter((i) => i.status === 'done').length;
  // Shared items carry their lane in `slot`: each lane lists only its own
  // copy. Ordinary 'either' tasks stay single-row (first Done wins for all).
  const split = (role: string) => items.filter((i) => (i as any).isShared
    ? (i as any).slot === role
    : (i.ownerRole === role || i.ownerRole === 'either'));
  // Frequency breakdown for TODAY — lets the dashboard show daily / weekly / monthly / quarterly / yearly completion vs incomplete.
  const FREQ_ORDER = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
  const freqStats = FREQ_ORDER.map((freq) => {
    const group = items.filter((i) => i.frequency === freq);
    const total = group.length;
    const done = group.filter((i) => i.status === 'done').length;
    const overdue = group.filter((i) => (i.overdue || i.status === 'not_done') && i.status !== 'done' && i.status !== 'skipped').length;
    const inprogress = group.filter((i) => i.status === 'inprogress').length;
    const pending = group.filter((i) => i.status === 'pending' || i.status === 'overdue').length;
    const completionPct = total > 0 ? Math.round((done / total) * 100) : 100;
    return { frequency: freq, total, done, pending, inprogress, overdue, incomplete: overdue, completionPct };
  });
  // Reference tasks with no fixed date (variable_per_item / to_be_decided):
  // always visible, never auto-instantiated, never overdue.
  const unscheduled = (templates as any[])
    .filter((t) => inLane(t) && UNSCHEDULED_RULES.has(String(parseRule(t)?.type ?? t.ruleType ?? '')))
    .map((t) => ({
      templateId: t.id,
      title: t.title,
      description: t.description,
      frequency: t.frequency,
      ownerRole: t.ownerRole,
      ruleType: t.ruleType ?? parseRule(t)?.type ?? null,
      note: (() => { try { return JSON.parse(String(t.ruleJson || '{}')).note ?? null; } catch { return null; } })(),
      dueLabel: t.rawText ?? null,
      isShared: !!t.isShared,
      employeeRaw: t.employeeRaw ?? null,
    }));
  // Incomplete tray: EVERY unresolved instance BEFORE today (same 120-day window
  // as carryover, capped at 500). Each repeat shows as its own row — a daily
  // missed 3 days in a row lists 3 rows, each with its own days-missed age.
  // The today-only taskbar would otherwise hide a missed daily/weekly until
  // its next due date — this list stays visible until each row is done, and
  // honours the same lane scoping as items. Per-day model: rows are never
  // rewritten to `overdue`; legacy `overdue` rows are included as not-done.
  const overdueLogs = await (prisma as any).accountsTaskLog.findMany({
    where: {
      dueDate: { gte: addDays(dateStr, -120), lt: dateStr },
      status: { in: ['pending', 'overdue', 'inprogress', 'not_done'] },
    },
    include: { template: true, accountant: true },
    orderBy: { dueDate: 'asc' },
    take: 500,
  }).catch(() => []);
  const overdueIds = (overdueLogs as any[]).map((l: any) => String(l.id)).filter(Boolean);
  const overdueFiles = overdueIds.length
    ? await (prisma as any).accountsTaskAttachment.findMany({
      where: { logId: { in: overdueIds } },
      orderBy: { createdAt: 'asc' },
    }).catch(() => [])
    : [];
  const overdueFilesByLog = new Map<string, any[]>();
  for (const f of overdueFiles as any[]) {
    const k = String(f.logId);
    if (!overdueFilesByLog.has(k)) overdueFilesByLog.set(k, []);
    overdueFilesByLog.get(k)!.push(f);
  }
  const overdueLogsScoped = (overdueLogs as any[])
    .filter((log: any) => log?.template && (log.template as any).active !== false && inLane(log.template))
    // Payment dues never enter the task Incomplete tray — they live in the
    // Payment dues tab (getPaymentDues), which has its own overdue bucket.
    .filter((log: any) => String((log.template as any)?.kind || 'task') !== 'payment')
    // Range grace: unresolved rows inside a still-open window stay out of the
    // Incomplete tray until the window's last day passes.
    .filter((log: any) => {
      const g = graceByTemplate.get(String((log as any).templateId));
      return !g || String((log as any).dueDate) < g;
    })
    // Lane viewers see only their own slot copy of shared rows (same rule as
    // today's cards — prevents cross-lane Done leakage in the tray too).
    .filter((log: any) => {
      const t: any = log.template;
      if (!laneEnforced || !t?.isShared) return true;
      return String((log as any).slot ?? SLOT_MAIN) === laneRole;
    });
  // Unresolved-day sets per (template :: slot) — the input for
  // consecutive-miss streaks on both today's cards and tray rows. A miss in
  // one lane must not inflate the other lane's streak.
  const unresolvedByTemplate = new Map<string, Set<string>>();
  for (const log of overdueLogsScoped) {
    const k = slotKey((log as any).templateId, (log as any).slot);
    if (!unresolvedByTemplate.has(k)) unresolvedByTemplate.set(k, new Set());
    unresolvedByTemplate.get(k)!.add(String((log as any).dueDate).slice(0, 10));
  }
  const templateById = new Map<string, any>((templates as any[]).map((t) => [String(t.id), t]));
  // Streak pass: today's cards count the trailing run before today…
  for (const it of items as any[]) {
    const tpl = templateById.get(String(it.templateId));
    const set = unresolvedByTemplate.get(slotKey(it.templateId, (it as any).isShared ? (it as any).slot : SLOT_MAIN)) ?? new Set<string>();
    const s = tpl ? missStreak(tpl, addDays(dateStr, -1), set) : 0;
    it.daysOverdue = s;
    it.daysIncomplete = s;
  }
  const overdueList = overdueLogsScoped
    .map((log: any) => {
      const t: any = log.template;
      return {
        templateId: t.id,
        title: t.title,
        description: t.description,
        frequency: t.frequency,
        ownerRole: t.ownerRole,
        dueDay: t.dueDay,
        dueMonth: t.dueMonth,
        ruleType: t.ruleType ?? parseRule(t)?.type ?? null,
        dueLabel: t.rawText ?? null,
        isShared: !!t.isShared,
        slot: String((log as any).slot ?? SLOT_MAIN),
        employeeRaw: t.employeeRaw ?? null,
        logId: log.id,
        dueDate: String(log.dueDate),
        status: log.status,
        remark: log.remark ?? null,
        doneBy: log.doneBy ?? null,
        timeSpentMin: log.timeSpentMin ?? null,
        accountantId: log.accountantId ?? null,
        accountantName: log.accountant?.name ?? null,
        updatedAt: log.updatedAt ?? null,
        attachments: overdueFilesByLog.get(String(log.id)) ?? [],
        missed: [],
        overdue: true,
        incomplete: true,
        daysOverdue: 0, // streak pass below
        daysIncomplete: 0, // streak pass below
      };
    });
  // …and each tray row counts the trailing run ending on its own due date.
  for (const row of overdueList as any[]) {
    const tpl = templateById.get(String(row.templateId));
    const set = unresolvedByTemplate.get(slotKey(row.templateId, row.isShared ? row.slot : SLOT_MAIN)) ?? new Set<string>();
    const s = tpl ? missStreak(tpl, String(row.dueDate), set) : 0;
    row.daysOverdue = s;
    row.daysIncomplete = s;
  }
  // Historical done — last 30 days BEFORE today, lane-scoped, capped.
  // Gives the Done tab's missing context and powers the new History view.
  const historyLogsRaw = await (prisma as any).accountsTaskLog.findMany({
    where: {
      dueDate: { gte: addDays(dateStr, -30), lt: dateStr },
      status: { in: ['done', 'skipped'] },
    },
    include: { template: true, accountant: true },
    orderBy: [{ dueDate: 'desc' }, { updatedAt: 'desc' }],
    take: 300,
  }).catch(() => []);
  const historyIds = (historyLogsRaw as any[]).map((l: any) => String(l.id)).filter(Boolean);
  const historyFiles = historyIds.length
    ? await (prisma as any).accountsTaskAttachment.findMany({
        where: { logId: { in: historyIds } },
        orderBy: { createdAt: 'asc' },
      }).catch(() => [])
    : [];
  const historyFilesByLog = new Map<string, any[]>();
  for (const f of historyFiles as any[]) {
    const k = String(f.logId);
    if (!historyFilesByLog.has(k)) historyFilesByLog.set(k, []);
    historyFilesByLog.get(k)!.push(toAttachmentJson(f));
  }
  const history = (historyLogsRaw as any[])
    .filter((log: any) => log?.template && (log.template as any).active !== false && inLane(log.template))
    // Payment dues never enter the task History tab — paid cycles live in the
    // Payment dues tab's Paid bucket.
    .filter((log: any) => String((log.template as any)?.kind || 'task') !== 'payment')
    .filter((log: any) => {
      const t: any = log.template;
      if (!laneEnforced || !t?.isShared) return true;
      return String((log as any).slot ?? SLOT_MAIN) === laneRole;
    })
    .map((log: any) => {
      const t: any = log.template;
      return {
        templateId: t.id,
        title: t.title,
        description: t.description,
        frequency: t.frequency,
        ownerRole: t.ownerRole,
        dueDay: t.dueDay,
        dueMonth: t.dueMonth,
        ruleType: t.ruleType ?? parseRule(t)?.type ?? null,
        dueLabel: t.rawText ?? null,
        isShared: !!t.isShared,
        slot: String((log as any).slot ?? SLOT_MAIN),
        employeeRaw: t.employeeRaw ?? null,
        logId: log.id,
        dueDate: String(log.dueDate),
        status: log.status,
        remark: log.remark ?? null,
        doneBy: log.doneBy ?? null,
        timeSpentMin: log.timeSpentMin ?? null,
        accountantId: log.accountantId ?? null,
        accountantName: log.accountant?.name ?? null,
        updatedAt: log.updatedAt ?? null,
        attachments: historyFilesByLog.get(String(log.id)) ?? [],
        missed: [],
        overdue: false,
        incomplete: false,
      };
    });
  const team = await computeTeam(dateStr, carriedEffective, { roster, todayLogs: logs });
  // Payment dues ride the same payload (no lane scoping). Fetch once.
  const paymentDues = await getPaymentDues(dateStr);
  const paymentHistory = await getPaymentHistory(dateStr);
  // Dispatch cash ledger rides along too (small table, no lane scoping).
  const { listCashEntries } = await import('./cash');
  const cashReport = await listCashEntries(1000).catch(() => ({
    entries: [], summary: { opening: 0, totalIn: 0, totalOut: 0, closing: 0, count: 0 },
  }));
  return {
    meta: {
      date: dateStr,
      today: istDateStr(),
      // Calc version tag (shown tiny in the UI header): proves which backend
      // logic produced these numbers. Bump when the dashboard math changes.
      computeV: 'slot-3',
      total: items.length,
      open: openCount,
      inProgress: inProgressCount,
      done: doneCount,
      overdue: overdueCount,
      incomplete: overdueCount,
      generatedAt: new Date().toISOString(),
      isAdmin: scope?.isAdmin ?? true,
      self: scope && !scope.isAdmin && scope.scope
        ? { id: scope.scope.selfId, name: scope.scope.selfName, role: scope.scope.selfRole }
        : null,
    },
    roster: (roster as any[]).map((r) => ({
      // Public team slice: identity + lane only (no emails/phones — those stay
      // behind the MIS-only roster endpoint, telecalling-parity). Enough for
      // the Who-picker, lane labels, and the team board.
      id: r.id, name: r.name, role: r.role, order: r.order,
    })),
    senior: laneEnforced && laneRole !== 'senior' ? [] : split('senior'),
    junior: laneEnforced && laneRole !== 'junior' ? [] : split('junior'),
    items,
    overdueList,
    incompleteList: overdueList,
    history,
    freqStats,
    unscheduled,
    // Payment dues ride the same payload (no lane scoping — any viewer of the
    // dashboard sees every due; the tab enforces nothing beyond dashboard
    // access, and writes are separately gated per route). `payments` = every
    // unresolved cycle; `paymentHistory` = every paid cycle, newest first.
    payments: paymentDues,
    paymentHistory,
    paymentSummary: summarizePayments(paymentDues, paymentHistory),
    cashEntries: (cashReport as any).entries,
    cashSummary: (cashReport as any).summary,
    team: { ...team, incompleteToday: (team as any).overdueToday },
  };
}

export async function getAccountsDashboardData(query: Record<string, any> = {}) {
  const date = String(query.date || '').slice(0, 10) || istDateStr();
  // Scope is part of the cache key: a junior must never be served a payload
  // computed for MIS (or vice versa).
  const scope = (query.scope ?? null) as { scope: LaneScope | null; isAdmin: boolean } | null;
  const scopeKey = !scope || scope.isAdmin ? 'all' : scope.scope ? `self:${scope.scope.selfId}` : 'unassigned';
  return cached(`${DATA_CACHE_PREFIX}${date}:${scopeKey}`, DATA_TTL_MS, () => computeDashboard(date, scope));
}

// ── MIS export: past-N-days full ledger ─────────────────────────────────────
// One row per (date × due task): status, who, remark, attachment links.
// Read-only (never creates instances) — a complete view of what was
// pending / done per senior-junior lane, for the MIS export.
// Minutes → "1h 20m" / "45m" for the MIS export. NULL/0 → null.
function fmtMins(v: unknown): string | null {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12) + n * 86400000).toISOString().slice(0, 10);
}

/** Whole days `from` (YYYY-MM-DD) is before `to` — the "N days overdue" count. */
export function diffDays(from: string, to: string): number {
  const a = Date.parse(String(from || '').slice(0, 10));
  const b = Date.parse(String(to || '').slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function getAccountsExport(daysRaw: unknown, origin: string, fromRaw?: unknown, toRaw?: unknown) {
  const today = istDateStr();
  // Explicit date range wins; otherwise the legacy past-N-days window.
  // Span is clamped to 93 days and `to` never runs past today.
  let from: string;
  let to: string;
  if (fromRaw != null || toRaw != null) {
    to = ISO_DAY.test(String(toRaw || '')) ? String(toRaw).slice(0, 10) : today;
    from = ISO_DAY.test(String(fromRaw || '')) ? String(fromRaw).slice(0, 10) : addDays(to, -29);
    if (to > today) to = today;
    if (from > to) throw new Error('from must be on or before to');
    if (diffDays(from, to) > 92) from = addDays(to, -92);
  } else {
    const days = Math.min(93, Math.max(1, Math.floor(Number(daysRaw) || 30)));
    to = today;
    from = addDays(today, -(days - 1));
  }
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  await ensureSeedTemplates();
    const [templates, logs] = await Promise.all([
    prisma.accountsTaskTemplate.findMany({ orderBy: { order: 'asc' } }),
    prisma.accountsTaskLog.findMany({
      where: { dueDate: { gte: from, lte: to } },
      include: { template: true, accountant: true },
      orderBy: { dueDate: 'desc' },
      take: 5000,
    }).catch(() => []),
  ]);
  const logIds = (logs as any[]).map((l) => String(l.id));
  const files = logIds.length
    ? await (prisma as any).accountsTaskAttachment.findMany({
      where: { logId: { in: logIds } },
      orderBy: { createdAt: 'asc' },
    }).catch(() => [])
    : [];
  const filesByLog = new Map<string, any[]>();
  for (const f of files as any[]) {
    const k = String(f.logId);
    if (!filesByLog.has(k)) filesByLog.set(k, []);
    filesByLog.get(k)!.push(f);
  }
  const base = String(origin || '').replace(/\/$/, '');
  const rows: Record<string, unknown>[] = [];
  let completed = 0;
  // Range grace as of today: rows inside a still-open window read pending,
  // not overdue — consistent with the dashboard.
  const graceToday = new Map<string, string>();
  for (const t of templates as any[]) {
    if (!t.active) continue;
    const g = windowGraceStart(t, today);
    if (g) graceToday.set(String(t.id), g);
  }
  for (const date of dates) {
    const due = (templates as any[]).filter(
      (t) => t.active && !UNSCHEDULED_RULES.has(String(parseRule(t)?.type ?? t.ruleType ?? '')) && isDueOn(t, date),
    );
    const dayLogs = (logs as any[]).filter((l) => String(l.dueDate) === date);
    const bySlot = new Map(dayLogs.map((l) => [slotKey(l.templateId, l.slot), l]));
    for (const t of due) {
      // Shared templates export one row per lane (each lane has its own log).
      const slots = t.isShared ? [...LANE_SLOTS] : [SLOT_MAIN];
      for (const slot of slots) {
      const log: any = bySlot.get(slotKey(t.id, slot));
      const status = log?.status ?? 'not-logged';
      const open = status === 'pending' || status === 'inprogress' || status === 'overdue' || status === 'not_done' || status === 'not-logged';
      // What matters: completed vs not completed. Only `done` counts as
      // completed — everything else (pending, not-logged, legacy rows) is
      // not completed.
      const result = status === 'done' ? 'Completed' : 'Not Completed';
      if (status === 'done') completed += 1;
      const graceStart = graceToday.get(String(t.id));
      rows.push({
        date,
        task: t.title,
        frequency: t.frequency,
        lane: t.isShared ? slot : t.ownerRole,
        shared: !!t.isShared,
        due: t.rawText ?? null,
        status,
        result,
        // Kept for compat: same day-1 rule as the dashboard (past open reads true),
        // minus range grace — inside a still-open window nothing reads overdue.
        overdue: status === 'overdue' || (open && date < today && !(graceStart && date >= graceStart)),
        doneBy: log?.doneBy ?? null,
        accountant: log?.accountant?.name ?? null,
        remark: log?.remark ?? null,
        timeSpentMin: log?.timeSpentMin ?? null,
        timeSpent: fmtMins(log?.timeSpentMin),
        attachments: ((log ? filesByLog.get(String(log.id)) ?? [] : []) as any[]).map((f) => ({
          name: String(f.fileName || ''),
          url: `${base}/api/accounts/files/${String(f.id || '')}`,
        })),
        updatedAt: log?.updatedAt instanceof Date ? log.updatedAt.toISOString() : (log?.updatedAt ? String(log.updatedAt) : null),
      });
      }
    }
  }
  const total = rows.length;
  const notCompleted = total - completed;
  return {
    from, to, days: dates.length, total, rows,
    completed, notCompleted,
    completionPct: total > 0 ? Math.round((completed / total) * 100) : 100,
  };
}

// ── Identity scoping (lane enforcement) ─────────────────────────────────────
// Non-MIS viewers only ever receive their own lane (role + shared). Mirrors
// the telecalling selfAgentId pattern: the frontend ALSO hides other tabs,
// but the payload itself is scoped so tab-switching can't leak lanes.
export interface LaneScope {
  selfId: string;
  selfRole: string;
  selfName: string;
}

function normId(s: unknown): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function resolveSelfAccountant(
  asId: unknown,
  me: { user?: { email?: string | null; name?: string | null } } | null,
): Promise<LaneScope | null> {
  const roster = (await prisma.accountant.findMany({ where: { deleted: false } })) as any[];
  // Declared identity first (the "Acting as" picker — authoritative for
  // shared logins). Must be a live roster row.
  if (asId) {
    const hit = roster.find((r) => String(r.id) === String(asId));
    if (hit) return { selfId: String(hit.id), selfRole: String(hit.role), selfName: String(hit.name) };
  }
  if (!me) return null;
  const meEmail = normId(me.user?.email);
  if (meEmail) {
    const byEmail = roster.filter((r) => r.email && normId(r.email) === meEmail);
    if (byEmail.length === 1) {
      const h = byEmail[0];
      return { selfId: String(h.id), selfRole: String(h.role), selfName: String(h.name) };
    }
  }
  const meName = normId(me.user?.name);
  if (meName.length >= 3) {
    const hits = roster.filter((r) => {
      const rn = normId(r.name);
      return rn && (rn === meName || rn.startsWith(meName) || meName.startsWith(rn));
    });
    if (hits.length === 1) {
      const h = hits[0];
      return { selfId: String(h.id), selfRole: String(h.role), selfName: String(h.name) };
    }
  }
  return null;
}

// ── Roster (MIS writes) ──────────────────────────────────────────────────────
export async function listAccountants(includeDeleted = false) {
  return prisma.accountant.findMany({
    where: includeDeleted ? {} : { deleted: false },
    orderBy: { order: 'asc' },
  });
}

export async function createAccountant(input: Record<string, any>) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('name required');
  const role = ['senior', 'junior'].includes(String(input.role)) ? String(input.role) : 'junior';
  const row = await prisma.accountant.create({
    data: {
      name,
      email: input.email ? String(input.email) : null,
      phone: input.phone ? String(input.phone) : null,
      role,
      order: Number(input.order ?? 0),
      deleted: false,
    },
  });
  await invalidateAccountsCache();
  await mirrorRosterRow('accountant', row);
  return row;
}

export async function updateAccountant(id: string, input: Record<string, any>) {
  const data: Record<string, any> = {};
  if (input.name !== undefined) data.name = String(input.name).trim();
  if (input.email !== undefined) data.email = input.email ? String(input.email) : null;
  if (input.phone !== undefined) data.phone = input.phone ? String(input.phone) : null;
  if (input.role !== undefined) {
    if (!['senior', 'junior'].includes(String(input.role))) throw new Error('role must be senior|junior');
    data.role = String(input.role);
  }
  if (input.order !== undefined) data.order = Number(input.order);
  if (input.deleted !== undefined) data.deleted = !!input.deleted;
  const row = await prisma.accountant.update({ where: { id }, data });
  await invalidateAccountsCache();
  await mirrorRosterRow('accountant', row);
  return row;
}

// ── Templates (MIS writes) ───────────────────────────────────────────────────
export async function listTemplates(includeInactive = false) {
  return prisma.accountsTaskTemplate.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: { order: 'asc' },
  });
}

function cleanTemplateInput(input: Record<string, any>, partial = false) {
  const data: Record<string, any> = {};
  if (input.title !== undefined || !partial) {
    const title = String(input.title || '').trim();
    if (!title && !partial) throw new Error('title required');
    if (title) data.title = title;
  }
  if (input.description !== undefined) data.description = input.description ? String(input.description) : null;
  if (input.frequency !== undefined) {
    if (!(FREQUENCIES as readonly string[]).includes(String(input.frequency))) {
      throw new Error(`frequency must be ${FREQUENCIES.join('|')}`);
    }
    data.frequency = String(input.frequency);
  }
  if (input.ownerRole !== undefined) {
    if (!(OWNER_ROLES as readonly string[]).includes(String(input.ownerRole))) {
      throw new Error(`ownerRole must be ${OWNER_ROLES.join('|')}`);
    }
    data.ownerRole = String(input.ownerRole);
  }
  if (input.dueDay !== undefined) data.dueDay = input.dueDay === null ? null : Number(input.dueDay);
  if (input.dueMonth !== undefined) data.dueMonth = input.dueMonth === null ? null : Number(input.dueMonth);
  if (input.ruleType !== undefined) {
    const allowed = ['not_applicable', 'fixed_day', 'day_range', 'multiple_days', 'weekday', 'week_of_month', 'month_day_range', 'multi_occurrence', 'variable_per_item', 'to_be_decided'];
    if (input.ruleType !== null && !allowed.includes(String(input.ruleType))) {
      throw new Error(`ruleType must be ${allowed.join('|')}`);
    }
    data.ruleType = input.ruleType ? String(input.ruleType) : null;
  }
  if (input.ruleJson !== undefined) {
    if (input.ruleJson !== null) {
      let parsed: any = input.ruleJson;
      if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { throw new Error('ruleJson must be valid JSON'); } }
      if (!parsed || typeof parsed !== 'object' || !parsed.type) throw new Error('ruleJson must be an object with a type');
      data.ruleJson = JSON.stringify(parsed);
      if (data.ruleType === undefined) data.ruleType = String(parsed.type);
    } else {
      data.ruleJson = null;
    }
  }
  if (input.rawText !== undefined) data.rawText = input.rawText ? String(input.rawText).slice(0, 500) : null;
  if (input.isShared !== undefined) data.isShared = !!input.isShared;
  if (input.employeeRaw !== undefined) data.employeeRaw = input.employeeRaw ? String(input.employeeRaw).slice(0, 200) : null;
  if (input.department !== undefined) data.department = input.department ? String(input.department).slice(0, 100) : null;
  if (input.sheetStatus !== undefined) data.sheetStatus = input.sheetStatus ? String(input.sheetStatus).slice(0, 50) : null;
  if (input.active !== undefined) data.active = !!input.active;
  if (input.order !== undefined) data.order = Number(input.order);
  // ── Payment dues (kind='payment' templates; task rows ignore these) ──────
  if (input.kind !== undefined) {
    if (!['task', 'payment'].includes(String(input.kind))) throw new Error('kind must be task|payment');
    data.kind = String(input.kind);
  }
  if (input.biller !== undefined) data.biller = input.biller ? String(input.biller).slice(0, 200) : null;
  // Optional bill number (card / mobile / account / policy …). Free text,
  // per-bill; every cycle inherits it. Empty clears it.
  if (input.identifier !== undefined) data.identifier = input.identifier ? String(input.identifier).slice(0, 100) : null;
  if (input.category !== undefined) {
    if (input.category !== null && !(PAYMENT_CATEGORIES as readonly string[]).includes(String(input.category))) {
      throw new Error(`category must be ${PAYMENT_CATEGORIES.join(' | ')}`);
    }
    data.category = input.category ? String(input.category) : null;
  }
  if (input.amount !== undefined) {
    if (input.amount === null || input.amount === '') data.amount = null;
    else {
      const n = Number(input.amount);
      if (!Number.isFinite(n) || n < 0) throw new Error('amount must be a number ≥ 0');
      data.amount = Math.round(n * 100) / 100;
    }
  }
  if (input.remindDays !== undefined) {
    const days = String(input.remindDays).split(',').map((s) => Math.floor(Number(s.trim())))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 60);
    data.remindDays = [...new Set(days)].sort((a, b) => b - a).join(',') || '7,3,1';
  }
  // Credit cards only: the statement day is when the amount first becomes
  // known. Switching a bill off 'Credit Card' clears it so a stale statement
  // date can't linger on a utility/EMI bill.
  if (input.statementDay !== undefined) {
    if (input.statementDay === null || input.statementDay === '') data.statementDay = null;
    else {
      const n = Math.floor(Number(input.statementDay));
      if (!Number.isFinite(n) || n < 1 || n > 31) throw new Error('statementDay must be 1–31');
      data.statementDay = n;
    }
  }
  if (input.category !== undefined && String(input.category) !== 'Credit Card' && input.statementDay === undefined) {
    data.statementDay = null;
  }
  // Billing model: 'fixed' (due on dueDay) or 'after_statement' (due =
  // statementDay + graceDays). Only meaningful for monthly credit cards —
  // anything else is forced back to fixed so task rows and other bills can
  // never carry a stale offset.
  if (input.dueMode !== undefined) {
    if (!['fixed', 'after_statement'].includes(String(input.dueMode))) {
      throw new Error('dueMode must be fixed|after_statement');
    }
    data.dueMode = String(input.dueMode);
  }
  if (input.graceDays !== undefined) {
    if (input.graceDays === null || input.graceDays === '') data.graceDays = null;
    else {
      const n = Math.floor(Number(input.graceDays));
      if (!Number.isFinite(n) || n < 1 || n > 60) throw new Error('graceDays must be 1–60');
      data.graceDays = n;
    }
  }
  // Resolve the effective values for cross-field validation. On partial
  // updates the caller may send only one side, so fall back to input for the
  // other (create path: input is the whole story).
  const effCategory = input.category !== undefined ? input.category : undefined;
  const effFreq = input.frequency !== undefined ? String(input.frequency) : undefined;
  const wantsOffset = (input.dueMode !== undefined ? String(input.dueMode) : undefined) === 'after_statement';
  if (wantsOffset) {
    if (effCategory !== undefined && String(effCategory) !== 'Credit Card') {
      throw new Error('after_statement is only for Credit Card bills');
    }
    if (effFreq !== undefined && effFreq !== 'monthly') {
      throw new Error('after_statement needs monthly repeats');
    }
    if (input.graceDays === undefined && !partial) {
      throw new Error('graceDays required for after_statement (days after statement)');
    }
  }
  if (input.category !== undefined && String(input.category) !== 'Credit Card') {
    if (input.dueMode === undefined) data.dueMode = 'fixed';
    if (input.graceDays === undefined) data.graceDays = null;
  }
  return data;
}

export async function createTemplate(input: Record<string, any>) {
  const row = await (prisma as any).accountsTaskTemplate.create({ data: { active: true, ...cleanTemplateInput(input) } as any });
  await invalidateAccountsCache();
  return row;
}

export async function updateTemplate(id: string, input: Record<string, any>) {
  const row = await prisma.accountsTaskTemplate.update({ where: { id }, data: cleanTemplateInput(input, true) });
  await invalidateAccountsCache();
  return row;
}

// ── Logging (taskbar write: status + remark + optional proof files) ─────────
// Status bar: pending → done. EVERY status change must carry a
// recorded reason: an empty remark on a transition is rejected (400) unless
// the log already holds one (which is then preserved, never wiped).
// `inprogress` / `overdue` / `skipped` are accepted for legacy compat only —
export async function logTask(
  logId: string,
  input: Record<string, any>,
  actor: string | null,
  // Server-resolved identity (roster id + name from the session / declared
  // `as`). Authoritative: the UI no longer sends who — Done is credited to
  // whoever is signed in, never to a client-supplied name.
  identity: { selfId: string; selfName: string } | null = null,
) {
  const status = String(input.status || '');
  // the UI sends pending/done/not_done (`not_done` = explicitly conceded with
  // a reason + owner; counts as not completed everywhere). `inprogress` /
  // `overdue` / `skipped` are accepted for legacy compat only — `overdue` was
  // once system-set and is now never written (past rows surface as incomplete
  // without a status rewrite).
  if (!['pending', 'inprogress', 'done', 'skipped', 'not_done'].includes(status)) {
    throw new Error('status must be pending|done|not_done');
  }
  const current: any = await prisma.accountsTaskLog.findUnique({ where: { id: logId } });
  if (!current) throw new Error('task log not found');
  let remark: string | null = input.remark !== undefined
    ? (input.remark ? String(input.remark).slice(0, 2000) : null)
    : (current.remark ?? null);
  // ── Payment proof (paidAmount + paidRef ride the same log row) ────────────
  // Marking a due paid carries its own paper trail, so a bare amount+ref is a
  // complete record: when no remark is given, the reference becomes the audit
  // line instead of rejecting the save.
  let paidAmount: number | null | undefined;
  if (input.paidAmount !== undefined) {
    if (input.paidAmount === null || input.paidAmount === '') paidAmount = null;
    else {
      const n = Number(input.paidAmount);
      if (!Number.isFinite(n) || n < 0) throw new Error('paidAmount must be a number ≥ 0');
      paidAmount = Math.round(n * 100) / 100;
    }
  }
  const paidRef = input.paidRef !== undefined
    ? (input.paidRef ? String(input.paidRef).slice(0, 200) : null)
    : undefined;
  if (status !== String(current.status) && !remark?.trim()) {
    if (paidRef?.trim()) remark = `Paid · ${paidRef.trim()}`;
    else if (String(current.remark || '').trim()) remark = current.remark; // preserve recorded reason
    else throw new Error('A remark (reason) is required to change status');
  }
  const data: Record<string, any> = { status, remark, updatedBy: actor };
  if (paidAmount !== undefined) data.paidAmount = paidAmount;
  if (paidRef !== undefined) data.paidRef = paidRef;
  const selfId = identity?.selfId ? String(identity.selfId) : null;
  if (selfId) {
    // Inferred identity wins. Marking done credits the signed-in (or
    // declared) person; other transitions leave the recorded owner alone.
    if (status === 'done') {
      data.accountantId = selfId;
      if (identity?.selfName) data.doneBy = String(identity.selfName).slice(0, 200);
    }
  } else {
    // No resolvable identity (MIS/admin not on the roster, or unresolved
    // shared login): honor explicit client values, then fall back to actor.
    if (input.doneBy !== undefined) data.doneBy = input.doneBy ? String(input.doneBy).slice(0, 200) : null;
    if (input.accountantId !== undefined) data.accountantId = input.accountantId ? String(input.accountantId) : null;
  }
  // Time taken (hours+minutes in the UI, integer minutes here). Optional and
  // editable on any status — correcting logged time never needs a transition.
  if (input.timeSpentMin !== undefined) {
    const mins = input.timeSpentMin === null || input.timeSpentMin === ''
      ? null
      : Math.max(0, Math.min(6000, Math.floor(Number(input.timeSpentMin))));
    if (mins === null) data.timeSpentMin = null;
    else if (Number.isFinite(mins)) data.timeSpentMin = mins;
    else throw new Error('timeSpentMin must be minutes (0-6000) or null');
  }
  // Marking done without naming anyone credits the signed-in user.
  if (status === 'done' && !data.doneBy && actor) data.doneBy = String(actor).slice(0, 200);
  if (data.accountantId) {
    // Never credit a removed (or unknown) roster entry: the id link is
    // dropped so ghosts can't collect points or appear as owners — but their
    // name is kept in doneBy as the history trail. Fail-open on read errors.
    try {
      const acc: any = await prisma.accountant.findUnique({ where: { id: String(data.accountantId) } });
      if (!acc || acc.deleted) {
        if (status === 'done' && !data.doneBy && acc?.name) data.doneBy = String(acc.name).slice(0, 200);
        data.accountantId = null;
      } else if (status === 'done' && !data.doneBy && acc.name) {
        data.doneBy = String(acc.name).slice(0, 200);
      }
    } catch { /* keep the id on read failure */ }
  }
  const row = await prisma.accountsTaskLog.update({ where: { id: logId }, data });
  await invalidateAccountsCache();
  return row;
}

// ── Payment dues (kind='payment' templates — the Payment dues tab) ───────────
// A payment template is a recurring bill (credit card, recharge, …). Each
// billing cycle is a log instance; marking paid = done + amount + reference.
// Structure: `dues` = EVERY unresolved cycle (all overdue, any age + due next
// 60d + one projected cycle per bill) · `history` = ALL paid cycles, newest
// first. Buckets on dues rows: overdue (past due, unpaid) · week (due within
// 7 days, with 7/3/1-day remind flags) · upcoming.
export type PaymentBucket = 'overdue' | 'week' | 'upcoming' | 'paid';

export interface PaymentAttachment {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
  url: string;
}

export interface PaymentDueRow {
  templateId: string;
  title: string;
  biller: string;
  identifier: string;
  category: string;
  amount: number | null;
  frequency: string;
  ownerRole: string;
  dueDay: number | null;
  dueMonth: number | null;
  remindDays: number[];
  /** Credit cards: statement day of month; null for every other category. */
  statementDay: number | null;
  /** Credit cards: 'fixed' (due on dueDay) or 'after_statement' (due =
   *  statementDay + graceDays). */
  dueMode: string;
  /** Credit cards on after_statement: days after the statement the bill is due. */
  graceDays: number | null;
  /** Date the statement that prices THIS cycle lands (null when no statement day). */
  statementDate: string | null;
  logId: string | null;
  dueDate: string;
  status: string;
  paidAmount: number | null;
  paidRef: string | null;
  remark: string | null;
  doneBy: string | null;
  updatedAt: string | null;
  bucket: PaymentBucket;
  daysOverdue: number;
  daysUntil: number;
  remind: boolean;
  attachments: PaymentAttachment[];
}

export interface PaymentSummary {
  unpaidTotal: number;
  unpaidCount: number;
  overdueCount: number;
  overdueTotal: number;
  weekCount: number;
  weekTotal: number;
  paidCount: number;
  paidTotal: number;
}

function parseRemindDays(raw: unknown): number[] {
  const days = String(raw ?? '7,3,1')
    .split(',')
    .map((s) => Math.floor(Number(s.trim())))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 60);
  const uniq = [...new Set(days)].sort((a, b) => b - a);
  return uniq.length ? uniq : [7, 3, 1];
}

/**
 * Statement date that prices the cycle due on `dueDate`.
 *
 * Fixed model: the statement is generated `statementDay` of a month and the
 * payment is due on `dueDay`. When the statement day lands BEFORE the due day
 * the pair sits in the same month (statement 2nd → due 15th); otherwise the
 * statement belongs to the previous month (statement 25th → due 15th of the
 * following month). The day is clamped to the month length so a 31st
 * statement works in February.
 *
 * Statement+days model (`graceDays` given): the due date IS statement +
 * graceDays, so the statement is simply due − graceDays.
 */
export function statementDateFor(dueDate: string, statementDay: number, graceDays?: number | null): string | null {
  const gg: any = graceDays;
  const g = gg === null || gg === undefined || gg === '' ? null : Math.floor(Number(gg));
  if (g !== null && Number.isFinite(g) && g >= 1 && g <= 60) {
    const dd = String(dueDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dd)) return null;
    return addDays(dd, -g);
  }
  const { y, m, d } = parseDay(dueDate);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const day = Math.floor(statementDay);
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  let sy = y;
  let sm = m;
  if (day >= d) {
    sm -= 1;
    if (sm < 1) { sm = 12; sy -= 1; }
  }
  return fmtDay(sy, sm, Math.min(day, daysInMonth(sy, sm)));
}

function toPaymentRow(t: any, log: any, dueDate: string, today: string, attachments: PaymentAttachment[] = []): PaymentDueRow {
  const done = !!log && String(log.status) === 'done';
  const dd = dueDate.slice(0, 10);
  const daysUntil = diffDays(today, dd);
  const remindDays = parseRemindDays((t as any).remindDays);
  const statementDayRaw = (t as any).statementDay;
  const statementDay = statementDayRaw === null || statementDayRaw === undefined || statementDayRaw === ''
    ? null
    : Number(statementDayRaw);
  const dueModeRaw = String((t as any)?.dueMode || 'fixed');
  const dueMode = dueModeRaw === 'after_statement' ? 'after_statement' : 'fixed';
  const graceRaw = (t as any)?.graceDays;
  const graceDays = graceRaw === null || graceRaw === undefined || graceRaw === ''
    ? null
    : Number(graceRaw);
  const bucket: PaymentBucket = done
    ? 'paid'
    : dd < today
      ? 'overdue'
      : daysUntil <= 7
        ? 'week'
        : 'upcoming';
  return {
    templateId: String(t.id),
    title: String(t.title ?? ''),
    biller: String((t as any).biller ?? ''),
    identifier: String((t as any).identifier ?? ''),
    category: String((t as any).category ?? 'Other'),
    amount: (t as any).amount === null || (t as any).amount === undefined ? null : Number((t as any).amount),
    frequency: String(t.frequency ?? 'monthly'),
    ownerRole: String(t.ownerRole ?? 'either'),
    dueDay: (t as any).dueDay ?? null,
    dueMonth: (t as any).dueMonth ?? null,
    remindDays,
    statementDay,
    statementDate: statementDay === null ? null : statementDateFor(dd, statementDay, dueMode === 'after_statement' ? graceDays : null),
    dueMode,
    graceDays: dueMode === 'after_statement' ? graceDays : null,
    logId: log ? String(log.id) : null,
    dueDate: dd,
    status: log ? String(log.status) : 'pending',
    paidAmount: log?.paidAmount === null || log?.paidAmount === undefined ? null : Number(log.paidAmount),
    paidRef: log?.paidRef ? String(log.paidRef) : null,
    remark: log?.remark ? String(log.remark) : null,
    doneBy: log?.doneBy ? String(log.doneBy) : null,
    updatedAt: log?.updatedAt ? String(log.updatedAt) : null,
    bucket,
    daysOverdue: !done && dd < today ? diffDays(dd, today) : 0,
    daysUntil,
    remind: !done && dd >= today && remindDays.includes(daysUntil),
    attachments,
  };
}

async function getPaymentTemplates(): Promise<any[]> {
  const templates = (await prisma.accountsTaskTemplate.findMany({
    where: { active: true },
    orderBy: { order: 'asc' },
  })) as any[];
  return templates.filter((t) => String((t as any).kind || 'task') === 'payment');
}

function toPaymentAttachment(f: any): PaymentAttachment {
  return {
    id: String(f?.id ?? ''),
    fileName: String(f?.fileName ?? ''),
    mime: String(f?.mime ?? 'application/octet-stream'),
    size: Number(f?.size ?? 0),
    uploadedBy: String(f?.uploadedBy ?? ''),
    createdAt: f?.createdAt instanceof Date ? f.createdAt.toISOString() : String(f?.createdAt ?? ''),
    url: `/api/accounts/files/${String(f?.id ?? '')}`,
  };
}

async function paymentAttachmentsByLog(logIds: string[]): Promise<Map<string, PaymentAttachment[]>> {
  const out = new Map<string, PaymentAttachment[]>();
  if (!logIds.length) return out;
  const files = await (prisma as any).accountsTaskAttachment.findMany({
    where: { logId: { in: logIds } },
    orderBy: { createdAt: 'asc' },
  }).catch(() => []);
  for (const f of files as any[]) {
    const k = String((f as any).logId);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(toPaymentAttachment(f));
  }
  return out;
}

/** EVERY unresolved cycle: all overdue (any age) + due next 60d + one projected
 *  cycle per bill when no instance covers it. Never drops a bill. */
export async function getPaymentDues(dateStr: string): Promise<PaymentDueRow[]> {
  const templates = await getPaymentTemplates();
  if (!templates.length) return [];
  const ids = templates.map((t) => String((t as any).id));
  const horizon = addDays(dateStr, 60);
  // No lower bound — a bill unpaid for months stays overdue until paid.
  const logs = await (prisma as any).accountsTaskLog
    .findMany({
      where: { templateId: { in: ids }, dueDate: { lte: horizon } },
      orderBy: { dueDate: 'asc' },
      take: 2000,
    })
    .catch(() => []);
  const byTemplate = new Map<string, any[]>();
  for (const l of logs as any[]) {
    const k = String((l as any).templateId);
    if (!byTemplate.has(k)) byTemplate.set(k, []);
    byTemplate.get(k)!.push(l);
  }
  const logIds = (logs as any[]).map((l) => String((l as any).id)).filter(Boolean);
  const filesByLog = await paymentAttachmentsByLog(logIds);
  const rows: PaymentDueRow[] = [];
  for (const t of templates) {
    const id = String((t as any).id);
    const tlogs = [...(byTemplate.get(id) ?? [])].sort((a, b) =>
      String(a.dueDate).localeCompare(String(b.dueDate)),
    );
    const open = tlogs.filter((l) => String(l.status) !== 'done');
    for (const l of open) {
      const dd = String(l.dueDate).slice(0, 10);
      rows.push(toPaymentRow(t, l, dd, dateStr, filesByLog.get(String(l.id)) ?? []));
    }
    // Next upcoming cycle (no instance yet — projected, paid on demand).
    const covered = new Set([...open].map((l) => String(l.dueDate).slice(0, 10)));
    for (let i = 0; i <= 60; i++) {
      const d = addDays(dateStr, i);
      if (covered.has(d)) continue;
      if (isDueOn(t, d)) {
        rows.push(toPaymentRow(t, null, d, dateStr, []));
        break;
      }
    }
  }
  return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
}

/** Complete paid history: every done cycle, newest first (cap 500). */
export async function getPaymentHistory(dateStr: string, limit = 500): Promise<PaymentDueRow[]> {
  const templates = await getPaymentTemplates();
  if (!templates.length) return [];
  const ids = templates.map((t) => String((t as any).id));
  const byId = new Map(templates.map((t) => [String((t as any).id), t]));
  const logs = await (prisma as any).accountsTaskLog
    .findMany({
      where: { templateId: { in: ids }, status: 'done' },
      orderBy: { dueDate: 'desc' },
      take: Math.min(1000, Math.max(50, limit)),
    })
    .catch(() => []);
  const filesByLog = await paymentAttachmentsByLog(
    (logs as any[]).map((l: any) => String(l.id)).filter(Boolean),
  );
  void dateStr;
  return (logs as any[])
    .map((l: any) => {
      const t = byId.get(String(l.templateId));
      if (!t) return null;
      return toPaymentRow(t, l, String(l.dueDate).slice(0, 10), String(l.dueDate).slice(0, 10), filesByLog.get(String(l.id)) ?? []);
    })
    .filter((r): r is PaymentDueRow => !!r)
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate) || a.title.localeCompare(b.title));
}

export function summarizePayments(dues: PaymentDueRow[], history: PaymentDueRow[]): PaymentSummary {
  let unpaidTotal = 0;
  let overdueTotal = 0;
  let weekTotal = 0;
  let overdueCount = 0;
  let weekCount = 0;
  for (const d of dues) {
    const amt = d.amount ?? 0;
    unpaidTotal += amt;
    if (d.bucket === 'overdue') { overdueCount++; overdueTotal += amt; }
    else if (d.bucket === 'week') { weekCount++; weekTotal += amt; }
  }
  return {
    unpaidTotal,
    unpaidCount: dues.length,
    overdueCount,
    overdueTotal,
    weekCount,
    weekTotal,
    paidCount: history.length,
    paidTotal: history.reduce((t, h) => t + (h.paidAmount ?? h.amount ?? 0), 0),
  };
}

/** Get-or-create the log instance for a payment cycle (pays projected dues). */
export async function ensurePaymentInstance(templateId: string, dueDate: string): Promise<any> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error('dueDate must be YYYY-MM-DD');
  const t: any = await prisma.accountsTaskTemplate.findUnique({ where: { id: templateId } });
  if (!t || (t as any).active === false) throw new Error('payment due not found');
  if (String((t as any).kind || 'task') !== 'payment') throw new Error('not a payment due');
  const existing = (await prisma.accountsTaskLog.findMany({ where: { templateId, dueDate } })) as any[];
  const hit = existing.find((r) => String(r.slot ?? SLOT_MAIN) === SLOT_MAIN);
  if (hit) return hit;
  try {
    return await prisma.accountsTaskLog.create({
      data: { templateId, dueDate, slot: SLOT_MAIN, status: 'pending' },
    });
  } catch {
    // Unique race — re-read.
    const retry = (await prisma.accountsTaskLog.findMany({ where: { templateId, dueDate } })) as any[];
    const r2 = retry.find((r) => String(r.slot ?? SLOT_MAIN) === SLOT_MAIN);
    if (!r2) throw new Error('could not create payment instance');
    return r2;
  }
}

/** Mark a payment cycle paid (amount + reference). Works on projected dues —
 *  the instance is created on demand, then logged through the same path as
 *  every other status change (identity credit, audit remark, cache bust). */
export async function payDue(
  templateId: string,
  dueDate: string,
  input: Record<string, any>,
  actor: string | null,
  identity: { selfId: string; selfName: string } | null = null,
) {
  if (input.paidAmount === undefined || input.paidAmount === null || input.paidAmount === '') {
    throw new Error('paidAmount is required to mark paid');
  }
  if (input.paidRef === undefined || input.paidRef === null || String(input.paidRef).trim() === '') {
    throw new Error('paidRef (UTR / transaction reference) is required to mark paid');
  }
  const inst: any = await ensurePaymentInstance(templateId, dueDate);
  if (String(inst.status) === 'done') {
    // Idempotent re-pay: already paid — refresh amount/ref instead of erroring,
    // so a double-click or retry can never create a duplicate cycle.
    return logTask(
      String(inst.id),
      { status: 'done', paidAmount: input.paidAmount, paidRef: input.paidRef, remark: input.remark },
      actor,
      identity,
    );
  }
  return logTask(
    String(inst.id),
    { status: 'done', paidAmount: input.paidAmount, paidRef: input.paidRef, remark: input.remark },
    actor,
    identity,
  );
}

// ── Proof attachments (bytes in CHAT_FILES KV; rows here) ────────────────────
export function toAttachmentJson(row: any) {
  return {
    id: String(row?.id ?? ''),
    logId: String(row?.logId ?? ''),
    fileName: String(row?.fileName ?? ''),
    mime: String(row?.mime ?? 'application/octet-stream'),
    size: Number(row?.size ?? 0),
    uploadedBy: String(row?.uploadedBy ?? ''),
    createdAt: row?.createdAt instanceof Date ? row.createdAt.toISOString() : String(row?.createdAt ?? ''),
    url: `/api/accounts/files/${String(row?.id ?? '')}`,
  };
}

export async function createAttachmentRecord(input: {
  logId: string; fileName: string; mime: string; size: number; kvKey: string; uploadedBy: string | null;
}) {
  const log: any = await prisma.accountsTaskLog.findUnique({ where: { id: input.logId } });
  if (!log) throw new Error('task log not found');
  const row = await (prisma as any).accountsTaskAttachment.create({
    data: {
      logId: input.logId,
      fileName: input.fileName.slice(0, 200),
      mime: input.mime,
      size: Math.max(0, Math.floor(input.size)),
      kvKey: input.kvKey,
      uploadedBy: String(input.uploadedBy || '').slice(0, 200),
      createdAt: new Date(),
    },
  });
  await invalidateAccountsCache();
  return row;
}

export async function getAttachment(id: string) {
  return (prisma as any).accountsTaskAttachment.findUnique({ where: { id } });
}

export async function deleteAttachmentRecord(id: string) {
  const row: any = await (prisma as any).accountsTaskAttachment.findUnique({ where: { id } });
  if (!row) throw new Error('Attachment not found');
  await (prisma as any).accountsTaskAttachment.delete({ where: { id } });
  await invalidateAccountsCache();
  return row;
}

// ── Team scoreboard (motivation: tasks done per person) ──────────────────────
function normName(s: unknown): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const wd = dt.getUTCDay(); // 0 Sun … 6 Sat
  const back = (wd + 6) % 7; // days since Monday
  return new Date(dt.getTime() - back * 86400000).toISOString().slice(0, 10);
}

async function computeTeam(
  todayStr: string,
  carried?: Map<string, string[]>,
  pre?: { roster: any[]; todayLogs: any[] },
) {
  const weekStart = mondayOf(todayStr);
  const monthStart = `${todayStr.slice(0, 7)}-01`;
  // Reuse the dashboard's already-fetched roster + today logs when provided —
  // only the month-to-date done ledger needs its own query (no includes: just
  // raw attribution fields, one round trip).
  const roster = (pre?.roster ?? await prisma.accountant.findMany({
    where: { deleted: false }, orderBy: { order: 'asc' },
  })) as any[];
  const [doneLogs, todayLogs] = await Promise.all([
    (prisma as any).accountsTaskLog.findMany({
      where: { status: 'done', dueDate: { gte: monthStart } },
      select: { accountantId: true, doneBy: true, dueDate: true },
    }).catch(() => []),
    pre?.todayLogs ?? prisma.accountsTaskLog.findMany({
      where: { dueDate: todayStr },
      include: { template: true },
    }).catch(() => []),
  ]);
  // Attribute each done log to a roster member: explicit accountantId first,
  // then fuzzy doneBy-name match (covers logs made before roster mapping).
  const credit = new Map<string, { today: number; week: number; month: number }>();
  for (const r of roster) credit.set(String(r.id), { today: 0, week: 0, month: 0 });
  const matchByName = (name: unknown): string | null => {
    const n = normName(name);
    if (!n || n.length < 3) return null;
    const hits = roster.filter((r) => {
      const rn = normName(r.name);
      const em = normName(r.email);
      return (rn && (rn === n || rn.startsWith(n) || n.startsWith(rn))) ||
        (em && (em === n || em.split('@')[0] === n));
    });
    return hits.length === 1 ? String(hits[0].id) : null;
  };
  for (const l of doneLogs as any[]) {
    const id = (l.accountantId && credit.has(String(l.accountantId)))
      ? String(l.accountantId)
      : matchByName(l.doneBy);
    if (!id || !credit.has(id)) continue;
    const c = credit.get(id)!;
    c.month += 1;
    if (String(l.dueDate) >= weekStart) c.week += 1;
    if (String(l.dueDate) === todayStr) c.today += 1;
  }
  // Open items in each member's role lane today (shared context, not assignment).
  const openByRole = { senior: 0, junior: 0 };
  let doneToday = 0;
  let openToday = 0;
  let inProgressToday = 0;
  let overdueToday = 0;
  for (const l of todayLogs as any[]) {
    if (l.status === 'done') { doneToday += 1; continue; }
    if (l.status === 'skipped') continue;
    if (l.status === 'overdue') { overdueToday += 1; continue; }
    openToday += 1;
    if (l.status === 'inprogress') inProgressToday += 1;
    // Shared rows count in their own slot's lane only (never double-counted).
    const tpl: any = l.template;
    const slot = String(l.slot ?? SLOT_MAIN);
    if (tpl?.isShared) {
      if (slot === SLOT_SENIOR) openByRole.senior += 1;
      else if (slot === SLOT_JUNIOR) openByRole.junior += 1;
      else { openByRole.senior += 1; openByRole.junior += 1; } // legacy main
      continue;
    }
    const role = String(tpl?.ownerRole || 'either');
    if (role === 'senior' || role === 'either') openByRole.senior += 1;
    if (role === 'junior' || role === 'either') openByRole.junior += 1;
  }
  const completionPct = doneToday + openToday > 0 ? Math.round((doneToday / (doneToday + openToday)) * 100) : 100;
  const members = roster.map((r) => {
    const c = credit.get(String(r.id))!;
    const lane = r.role === 'senior' ? openByRole.senior : openByRole.junior;
    return {
      id: r.id, name: r.name, role: r.role,
      doneToday: c.today, doneWeek: c.week, doneMonth: c.month,
      openLaneToday: lane,
    };
  }).sort((a, b) => b.doneMonth - a.doneMonth || b.doneWeek - a.doneWeek || b.doneToday - a.doneToday);
  let weekDone = 0;
  let monthDone = 0;
  for (const l of doneLogs as any[]) {
    monthDone += 1;
    if (String(l.dueDate) >= weekStart) weekDone += 1;
  }
  return {
    date: todayStr, weekStart, monthStart,
    doneToday, openToday, inProgressToday,
    // Carryover keys are per (template :: slot) — count distinct templates so
    // one shared task missed in both lanes still counts once here.
    overdueToday: overdueToday + (carried ? new Set([...carried.keys()].map((k) => String(k).split('::')[0])).size : 0),
    completionPct, weekDone, monthDone,
    members,
  };
}
