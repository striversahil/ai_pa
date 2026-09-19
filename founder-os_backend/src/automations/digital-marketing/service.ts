import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { cached, cacheDel } from '../../shared/cache';

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
export const OWNER_ROLES = ['manager', 'either'] as const;
// Per-day workflow: pending → done, or pending → not_done (explicitly conceded
// with a reason + owner). `inprogress` / `skipped` / `overdue` are legacy (old
// UI offered inprogress; rollover once materialised overdue). Tasks never carry
// over: anything not done by EOD stays on its own day as "not done" and
// surfaces in the Incomplete tab. Past rows are never rewritten.
export const LOG_STATUSES = ['pending', 'inprogress', 'done', 'skipped', 'not_done'] as const;

const DATA_TTL_MS = 5 * 60 * 1000;
const DATA_CACHE_PREFIX = 'digital-marketing:dashboard:';

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

/** Legacy path for simple MIS-created tasks (no ruleJson): frequency + dueDay/dueMonth. */
function legacyDueOn(t: any, y: number, m: number, d: number, wd: number, dim: number): boolean {
  const freq = String(t.frequency || 'daily');
  if (freq === 'daily') return wd >= 1 && wd <= 6;
  if (freq === 'weekly') return wd === Number(t.dueDay ?? 4);
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
    const count = await prisma.digitalMarketingTaskTemplate.count();
    if (count > 0) return;
    for (const t of SEED_TASKS) {
      await (prisma as any).digitalMarketingTaskTemplate.create({ data: { ...(t as any) } });
    }
    logger.info({ n: SEED_TASKS.length }, 'digital-marketing: seeded follow-up templates');
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'digital-marketing: seed failed (best-effort)');
  }
}

/** Ensure one log row per due template for `dateStr` (idempotent). */
export async function ensureInstances(dateStr: string): Promise<number> {
  await ensureSeedTemplates();
  const templates = await prisma.digitalMarketingTaskTemplate.findMany({ where: { active: true } });
  const due = templates.filter((t: any) => isDueOn(t, dateStr));
  if (due.length === 0) return 0;
  const existing = await prisma.digitalMarketingTaskLog.findMany({
    where: { dueDate: dateStr, templateId: { in: due.map((t: any) => t.id) } },
    select: { templateId: true },
  });
  const have = new Set((existing as any[]).map((r) => String(r.templateId)));
  const missing = (due as any[]).filter((t) => !have.has(String(t.id)));
  if (missing.length === 0) return 0;
  // One batched INSERT + one re-read (2 round trips total). Unique
  // (templateId, dueDate) keeps concurrent rollovers idempotent — on conflict
  // the batch throws and we fall back to idempotent per-row creates.
  try {
    const rows = await (prisma as any).digitalMarketingTaskLog.createManyAndReturn({
      data: missing.map((t: any) => ({ templateId: String(t.id), dueDate: dateStr, status: 'pending' })),
    });
    return Array.isArray(rows) ? rows.length : missing.length;
  } catch {
    const results = await Promise.all(missing.map(async (t: any) => {
      try {
        await prisma.digitalMarketingTaskLog.create({ data: { templateId: t.id, dueDate: dateStr, status: 'pending' } });
        return 1;
      } catch { return 0; /* unique race — ignore */ }
    }));
    return results.reduce<number>((a, b) => a + b, 0);
  }
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
 * this map lets today's row wear a "missed 15th" badge and count as incomplete.
 */
export async function getCarriedOverdue(
  templateIds: string[], dateStr: string, lookbackDays = 120,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!templateIds.length) return out;
  const from = addDays(dateStr, -lookbackDays);
  const rows = await (prisma as any).digitalMarketingTaskLog.findMany({
    where: {
      templateId: { in: templateIds },
      dueDate: { gte: from, lt: dateStr },
      status: { in: ['pending', 'overdue', 'inprogress', 'not_done'] },
    },
    select: { templateId: true, dueDate: true },
    orderBy: { dueDate: 'asc' },
    take: 2000,
  }).catch(() => []);
  for (const r of rows as any[]) {
    const k = String(r.templateId);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(String(r.dueDate));
  }
  return out;
}

export async function runDailyRollover(): Promise<{ date: string; created: number; overdue: number }> {
  const today = istDateStr();
  const created = await ensureInstances(today);
  const overdue = await flagOverdue(today);
  await invalidateDigitalMarketingCache();
  return { date: today, created, overdue };
}

export async function invalidateDigitalMarketingCache(): Promise<void> {
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
  const [roster, templates, logs] = await Promise.all([
    prisma.digitalMarketingManager.findMany({ where: { deleted: false }, orderBy: { order: 'asc' } }),
    prisma.digitalMarketingTaskTemplate.findMany({ where: { active: true }, orderBy: { order: 'asc' } }),
    prisma.digitalMarketingTaskLog.findMany({
      where: { dueDate: dateStr },
      include: { template: true, accountant: true },
    }),
  ]);
  const logIds = (logs as any[]).map((l) => String(l.id)).filter(Boolean);
  const attachments = logIds.length
    ? await (prisma as any).digitalMarketingTaskAttachment.findMany({
      where: { logId: { in: logIds } },
      orderBy: { createdAt: 'asc' },
    }).catch(() => [])
    : [];
  const byTemplate = new Map((logs as any[]).map((l) => [String(l.templateId), l]));
  const active = (templates as any[]).filter((t) => !UNSCHEDULED_RULES.has(String(parseRule(t)?.type ?? t.ruleType ?? '')));
  // Lane enforcement: non-MIS viewers only receive their own lane (their role
  // plus shared). Admins, and logged-out callers where the auth gate is off
  // (local/dev), receive everything. Logged-in non-roster viewers receive
  // nothing but the team board.
  const laneRole = scope && !scope.isAdmin ? (scope.scope?.selfRole ?? null) : null;
  const laneEnforced = !!scope && !scope.isAdmin;
  const inLane = (t: any) => !laneEnforced || (laneRole !== null && (t.ownerRole === 'either' || t.ownerRole === laneRole));
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
    const g = graceByTemplate.get(k);
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
  // row stays in the Incomplete tray with its own days-missed count, and today
  // always shows as a new entry (never suppressed by the backlog).
  const items = dueTemplates
    .map((t) => {
      const log = byTemplate.get(String(t.id));
      const status = log?.status ?? 'pending';
      const missed = carriedEffective.get(String(t.id)) ?? [];
      const isOverdueRow = missed.length > 0 || status === 'overdue' || status === 'not_done' || ((status === 'pending' || status === 'inprogress') && String(dateStr) < istDateStr());
      let metricsSchema: any = null;
      try { metricsSchema = t.metricsSchema ? JSON.parse(String(t.metricsSchema)) : null; } catch { metricsSchema = null; }
      let metricsJson: any = null;
      try { metricsJson = log?.metricsJson ? JSON.parse(String(log.metricsJson)) : null; } catch { metricsJson = null; }
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
        employeeRaw: t.employeeRaw ?? null,
        metricsSchema,
        logId: log?.id ?? null,
        status,
        remark: log?.remark ?? null,
        doneBy: log?.doneBy ?? null,
        metricsJson,
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
    });
  const OPEN = new Set(['pending', 'inprogress', 'overdue', 'not_done']);
  const overdueCount = items.filter((i) => i.overdue && i.status !== 'done' && i.status !== 'skipped').length;
  const openCount = items.filter((i) => OPEN.has(i.status)).length;
  const inProgressCount = items.filter((i) => i.status === 'inprogress').length;
  const doneCount = items.filter((i) => i.status === 'done').length;
  const split = (role: string) => items.filter((i) => i.ownerRole === role || i.ownerRole === 'either');
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
  // always visible, never auto-instantiated, never incomplete.
  const unscheduled = (templates as any[])
    .filter((t) => inLane(t) && UNSCHEDULED_RULES.has(String(parseRule(t)?.type ?? t.ruleType ?? '')))
    .map((t) => {
      let metricsSchema: any = null;
      try { metricsSchema = (t as any).metricsSchema ? JSON.parse(String((t as any).metricsSchema)) : null; } catch { metricsSchema = null; }
      return {
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
        metricsSchema,
      };
    });
  // Incomplete tray: EVERY unresolved instance BEFORE today (same 120-day window
  // as carryover, capped at 500). Each repeat shows as its own row — a daily
  // missed 3 days in a row lists 3 rows, each with its own days-missed age.
  // Per-day model: rows are never rewritten to `overdue`; legacy `overdue`
  // rows are included as not-done.
  const overdueLogs = await (prisma as any).digitalMarketingTaskLog.findMany({
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
    ? await (prisma as any).digitalMarketingTaskAttachment.findMany({
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
    // Range grace: unresolved rows inside a still-open window stay out of the
    // Incomplete tray until the window's last day passes.
    .filter((log: any) => {
      const g = graceByTemplate.get(String((log as any).templateId));
      return !g || String((log as any).dueDate) < g;
    });
  // Unresolved-day sets per template (open instances before `dateStr`) — the
  // input for consecutive-miss streaks on both today's cards and tray rows.
  const unresolvedByTemplate = new Map<string, Set<string>>();
  for (const log of overdueLogsScoped) {
    const k = String((log as any).templateId);
    if (!unresolvedByTemplate.has(k)) unresolvedByTemplate.set(k, new Set());
    unresolvedByTemplate.get(k)!.add(String((log as any).dueDate).slice(0, 10));
  }
  const templateById = new Map<string, any>((templates as any[]).map((t) => [String(t.id), t]));
  // Streak pass: today's cards count the trailing run before today…
  for (const it of items as any[]) {
    const tpl = templateById.get(String(it.templateId));
    const set = unresolvedByTemplate.get(String(it.templateId)) ?? new Set<string>();
    const s = tpl ? missStreak(tpl, addDays(dateStr, -1), set) : 0;
    it.daysOverdue = s;
    it.daysIncomplete = s;
  }
  const overdueList = overdueLogsScoped
    .map((log: any) => {
      const t: any = log.template;
      let metricsSchema: any = null;
      try { metricsSchema = t.metricsSchema ? JSON.parse(String(t.metricsSchema)) : null; } catch { metricsSchema = null; }
      let metricsJson: any = null;
      try { metricsJson = log.metricsJson ? JSON.parse(String(log.metricsJson)) : null; } catch { metricsJson = null; }
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
        employeeRaw: t.employeeRaw ?? null,
        metricsSchema,
        logId: log.id,
        dueDate: String(log.dueDate),
        status: log.status,
        remark: log.remark ?? null,
        doneBy: log.doneBy ?? null,
        metricsJson,
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
    const set = unresolvedByTemplate.get(String(row.templateId)) ?? new Set<string>();
    const s = tpl ? missStreak(tpl, String(row.dueDate), set) : 0;
    row.daysOverdue = s;
    row.daysIncomplete = s;
  }
  // Historical done — last 30 days BEFORE today, lane-scoped, capped.
  // Gives the Done tab's missing context and powers the new History view.
  const historyLogsRaw = await (prisma as any).digitalMarketingTaskLog.findMany({
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
    ? await (prisma as any).digitalMarketingTaskAttachment.findMany({
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
    .map((log: any) => {
      const t: any = log.template;
      let metricsSchema: any = null;
      try { metricsSchema = t.metricsSchema ? JSON.parse(String(t.metricsSchema)) : null; } catch { metricsSchema = null; }
      let metricsJson: any = null;
      try { metricsJson = log.metricsJson ? JSON.parse(String(log.metricsJson)) : null; } catch { metricsJson = null; }
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
        employeeRaw: t.employeeRaw ?? null,
        metricsSchema,
        logId: log.id,
        dueDate: String(log.dueDate),
        status: log.status,
        remark: log.remark ?? null,
        doneBy: log.doneBy ?? null,
        metricsJson,
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
  // Active Meta Ads campaign window (Saturday start → daily capture during run).
  const metaAdsCampaign: any = await getActiveMetaCampaign(dateStr).catch(() => null);
  // Carry-forward: today's Meta Ads Run box inherits the active campaign's
  // category/amount/from-to for DISPLAY so every day of the run shows what
  // campaign the inquiries/leads belong to (the day's own inquiries/leads win).
  // DB rows are untouched — saving the day writes its own metricsJson.
  if (metaAdsCampaign) {
    const todayRun = (items as any[]).find((i) => String(i.templateId) === 'dmm-06');
    if (todayRun && String(todayRun.logId ?? '') !== String(metaAdsCampaign.logId ?? '')) {
      const cur = (todayRun.metricsJson && typeof todayRun.metricsJson === 'object') ? todayRun.metricsJson : {};
      const pick = (k: string) => (cur as any)[k] ?? null;
      todayRun.metricsJson = {
        ...cur,
        category: pick('category') ?? (metaAdsCampaign as any).category ?? null,
        amountSpent: pick('amountSpent') ?? (metaAdsCampaign as any).amountSpent ?? null,
        fromDate: pick('fromDate') ?? (metaAdsCampaign as any).fromDate ?? null,
        toDate: pick('toDate') ?? (metaAdsCampaign as any).toDate ?? null,
      };
      (todayRun as any).campaignCarried = true;
    }
  }
  const team = await computeTeam(dateStr, carriedEffective, { roster, todayLogs: logs });
  return {
    meta: {
      date: dateStr,
      today: istDateStr(),
      // Calc version tag (shown tiny in the UI header): proves which backend
      // logic produced these numbers. Bump when the dashboard math changes.
      computeV: 'streak-1',
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
    manager: laneEnforced && laneRole !== 'manager' ? [] : split('manager'),
    senior: [],
    junior: [],
    items,
    overdueList,
    incompleteList: overdueList,
    history,
    freqStats,
    unscheduled,
    metaAdsCampaign,
    team: { ...team, incompleteToday: (team as any).overdueToday },
  };
}
export const getAccountsDashboardData = getDigitalMarketingDashboardData;

export async function getDigitalMarketingDashboardData(query: Record<string, any> = {}) {
  const date = String(query.date || '').slice(0, 10) || istDateStr();
  // Scope is part of the cache key: a non-MIS viewer must never be served a payload
  // computed for MIS (or vice versa).
  const scope = (query.scope ?? null) as { scope: LaneScope | null; isAdmin: boolean } | null;
  const scopeKey = !scope || scope.isAdmin ? 'all' : scope.scope ? `self:${scope.scope.selfId}` : 'unassigned';
  return cached(`${DATA_CACHE_PREFIX}${date}:${scopeKey}`, DATA_TTL_MS, () => computeDashboard(date, scope));
}

// ── MIS export: past-N-days full ledger ─────────────────────────────────────
// One row per (date × due task): status, who, remark, attachment links.
// Read-only (never creates instances) — a complete view of what was
// pending / in-progress / done for the single-manager taskbar, for the MIS export.
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

function parseMetricsJson(raw: unknown): Record<string, any> {
  if (!raw) return {};
  try {
    const o = typeof raw === 'string' ? JSON.parse(String(raw)) : raw;
    return o && typeof o === 'object' && !Array.isArray(o) ? o as Record<string, any> : {};
  } catch { return {}; }
}

function durationDaysBetween(from: string, to: string): number | null {
  const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').slice(0, 10));
  if (!ok(from) || !ok(to)) return null;
  const ms = Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10));
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 86400000) + 1;
}

/** Whole days `from` (YYYY-MM-DD) is before `to` — the "N days overdue" count. */
export function diffDays(from: string, to: string): number {
  const a = Date.parse(String(from || '').slice(0, 10));
  const b = Date.parse(String(to || '').slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

/**
 * Active Meta Ads campaign for `dateStr`: the most recent dmm-06 log (lookback
 * 60 days incl. today) whose [fromDate, toDate] window covers `dateStr`.
 * Saturday starts the campaign; the daily box stays open for inquiries/leads
 * for the whole duration — the dashboard wears this as a banner.
 */
export async function getActiveMetaCampaign(dateStr: string): Promise<Record<string, any> | null> {
  const from = addDays(dateStr, -60);
  const rows = await (prisma as any).digitalMarketingTaskLog.findMany({
    where: { templateId: 'dmm-06', dueDate: { gte: from, lte: dateStr } },
    orderBy: { dueDate: 'desc' },
    take: 60,
  }).catch(() => []);
  for (const r of rows as any[]) {
    const m = parseMetricsJson((r as any).metricsJson);
    const f = String((m as any).fromDate ?? '').slice(0, 10);
    const t = String((m as any).toDate ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) continue;
    if (f <= dateStr && dateStr <= t) {
      return {
        logId: String((r as any).id),
        dueDate: String((r as any).dueDate),
        category: (m as any).category ?? null,
        amountSpent: (m as any).amountSpent ?? null,
        fromDate: f,
        toDate: t,
        durationDays: durationDaysBetween(f, t),
        inquiries: (m as any).inquiries ?? null,
        leads: (m as any).leads ?? null,
      };
    }
  }
  return null;
}

export async function getDigitalMarketingExport(daysRaw: unknown, origin: string) {
  const days = Math.min(93, Math.max(1, Math.floor(Number(daysRaw) || 30)));
  const today = istDateStr();
  const dates: string[] = [];
  for (let i = 0; i < days; i++) dates.push(addDays(today, -i));
  const from = dates[dates.length - 1];
  await ensureSeedTemplates();
  const [templates, logs] = await Promise.all([
    prisma.digitalMarketingTaskTemplate.findMany({ orderBy: { order: 'asc' } }),
    prisma.digitalMarketingTaskLog.findMany({
      where: { dueDate: { gte: from, lte: today } },
      include: { template: true, accountant: true },
      orderBy: { dueDate: 'desc' },
      take: 5000,
    }).catch(() => []),
  ]);
  const logIds = (logs as any[]).map((l) => String(l.id));
  const files = logIds.length
    ? await (prisma as any).digitalMarketingTaskAttachment.findMany({
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
  // Meta campaign windows declared in-range (Saturday starts): any dmm-06 log
  // carrying a valid [fromDate, toDate] defines a run. Weekday rows inside a
  // run inherit category/amount/from-to when their own log left them blank —
  // so MIS sees which campaign each day's inquiries/leads belong to.
  const metaWindows = (logs as any[])
    .filter((l) => String((l as any).templateId) === 'dmm-06')
    .map((l) => {
      const mm = parseMetricsJson((l as any).metricsJson);
      const f = String((mm as any).fromDate ?? '').slice(0, 10);
      const tt = String((mm as any).toDate ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(tt) || f > tt) return null;
      return { f, t: tt, category: (mm as any).category ?? null, amountSpent: (mm as any).amountSpent ?? (mm as any).amount ?? null };
    })
    .filter(Boolean) as { f: string; t: string; category: string | null; amountSpent: number | null }[];
  const coveringWindow = (date: string) => metaWindows.find((w) => w.f <= date && date <= w.t) ?? null;
  for (const date of dates) {
    const due = (templates as any[]).filter(
      (t) => t.active && !UNSCHEDULED_RULES.has(String(parseRule(t)?.type ?? t.ruleType ?? '')) && isDueOn(t, date),
    );
    const byTemplate = new Map((logs as any[]).filter((l) => String(l.dueDate) === date).map((l) => [String(l.templateId), l]));
    for (const t of due) {
      const log: any = byTemplate.get(String(t.id));
      const status = log?.status ?? 'not-logged';
      const open = status === 'pending' || status === 'inprogress' || status === 'overdue' || status === 'not_done' || status === 'not-logged';
      // What matters: completed vs not completed. Only `done` counts as
      // completed — everything else is not completed.
      const result = status === 'done' ? 'Completed' : 'Not Completed';
      if (status === 'done') completed += 1;
      const graceStart = graceToday.get(String(t.id));
      const m = parseMetricsJson(log?.metricsJson);
      const win = String(t.id) === 'dmm-06' ? coveringWindow(date) : null;
      const mFrom = String((m as any).fromDate ?? (win as any)?.f ?? '').slice(0, 10) || null;
      const mTo = String((m as any).toDate ?? (win as any)?.t ?? '').slice(0, 10) || null;
      rows.push({
        date,
        task: t.title,
        templateId: t.id,
        frequency: t.frequency,
        lane: t.ownerRole,
        shared: !!t.isShared,
        due: t.rawText ?? null,
        status,
        result,
        overdue: status === 'overdue' || (open && date < today && !(graceStart && date >= graceStart)),
        doneBy: log?.doneBy ?? null,
        accountant: log?.accountant?.name ?? null,
        remark: log?.remark ?? null,
        timeSpentMin: log?.timeSpentMin ?? null,
        timeSpent: fmtMins(log?.timeSpentMin),
        // Structured daily numbers (Meta Ads Run title highlight: category /
        // amount / from-to / duration / inquiries / leads; whatsapp +amount).
        metricsJson: log?.metricsJson ? (() => { try { return JSON.parse(String(log.metricsJson)); } catch { return String(log.metricsJson); } })() : null,
        category: (m as any).category ?? (win as any)?.category ?? null,
        amountSpent: (m as any).amountSpent ?? (m as any).amount ?? (win as any)?.amountSpent ?? null,
        fromDate: mFrom,
        toDate: mTo,
        durationDays: mFrom && mTo ? durationDaysBetween(mFrom, mTo) : null,
        inquiries: (m as any).inquiries ?? null,
        leads: (m as any).leads ?? (m as any).whatsappLeads ?? (m as any).emailLeads ?? null,
        dataSource: (m as any).dataSource ?? null,
        attachments: ((log ? filesByLog.get(String(log.id)) ?? [] : []) as any[]).map((f) => ({
          name: String(f.fileName || ''),
          url: `${base}/api/accounts/files/${String(f.id || '')}`,
        })),
        updatedAt: log?.updatedAt instanceof Date ? log.updatedAt.toISOString() : (log?.updatedAt ? String(log.updatedAt) : null),
      });
    }
  }
  return {
    from, to: today, days, total: rows.length, rows,
    completed, notCompleted: rows.length - completed,
    completionPct: rows.length > 0 ? Math.round((completed / rows.length) * 100) : 100,
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

export async function resolveSelfDigitalMarketingManager(
  asId: unknown,
  me: { user?: { email?: string | null; name?: string | null } } | null,
): Promise<LaneScope | null> {
  const roster = (await prisma.digitalMarketingManager.findMany({ where: { deleted: false } })) as any[];
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
export async function listDigitalMarketingManagers(includeDeleted = false) {
  return prisma.digitalMarketingManager.findMany({
    where: includeDeleted ? {} : { deleted: false },
    orderBy: { order: 'asc' },
  });
}

export async function createDigitalMarketingManager(input: Record<string, any>) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('name required');
  const role = ['manager', 'either'].includes(String(input.role)) ? String(input.role) : 'manager';
  const row = await prisma.digitalMarketingManager.create({
    data: {
      name,
      email: input.email ? String(input.email) : null,
      phone: input.phone ? String(input.phone) : null,
      role,
      order: Number(input.order ?? 0),
      deleted: false,
    },
  });
  await invalidateDigitalMarketingCache();
  return row;
}

export async function updateDigitalMarketingManager(id: string, input: Record<string, any>) {
  const data: Record<string, any> = {};
  if (input.name !== undefined) data.name = String(input.name).trim();
  if (input.email !== undefined) data.email = input.email ? String(input.email) : null;
  if (input.phone !== undefined) data.phone = input.phone ? String(input.phone) : null;
  if (input.role !== undefined) {
    if (!['manager', 'either'].includes(String(input.role))) throw new Error('role must be manager|either');
    data.role = String(input.role);
  }
  if (input.order !== undefined) data.order = Number(input.order);
  if (input.deleted !== undefined) data.deleted = !!input.deleted;
  const row = await prisma.digitalMarketingManager.update({ where: { id }, data });
  await invalidateDigitalMarketingCache();
  return row;
}

// ── Templates (MIS writes) ───────────────────────────────────────────────────
export async function listTemplates(includeInactive = false) {
  return prisma.digitalMarketingTaskTemplate.findMany({
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
  if (input.metricsSchema !== undefined) {
    if (input.metricsSchema === null) data.metricsSchema = null;
    else {
      try {
        const v = typeof input.metricsSchema === 'string' ? JSON.parse(input.metricsSchema) : input.metricsSchema;
        if (!Array.isArray(v)) throw new Error('metricsSchema must be array');
        data.metricsSchema = JSON.stringify(v);
      } catch { throw new Error('metricsSchema must be valid JSON array'); }
    }
  }
  if (input.active !== undefined) data.active = !!input.active;
  if (input.order !== undefined) data.order = Number(input.order);
  return data;
}

export async function createTemplate(input: Record<string, any>) {
  const row = await (prisma as any).digitalMarketingTaskTemplate.create({ data: { active: true, ...cleanTemplateInput(input) } as any });
  await invalidateDigitalMarketingCache();
  return row;
}

export async function updateTemplate(id: string, input: Record<string, any>) {
  const row = await prisma.digitalMarketingTaskTemplate.update({ where: { id }, data: cleanTemplateInput(input, true) });
  await invalidateDigitalMarketingCache();
  return row;
}

// ── Logging (taskbar write: status + remark + optional proof files) ─────────
// Status bar: pending → done. EVERY status change must carry a
// recorded reason: an empty remark on a transition is rejected (400) unless
// the log already holds one (which is then preserved, never wiped).
// `inprogress` / `overdue` / `skipped` are accepted for legacy compat only —
// the UI only sends pending/done. `overdue` was once system-set and is now
// never written (past rows surface as incomplete without a status rewrite).
// Whatsapp (dmm-08) + Email (dmm-09) marketing additionally require, on Done:
//   1. a "data used" source (metrics.dataSource — which list/database was used)
//   2. at least one proof attachment (the data file / screenshot attached below)
const MARKETING_PROOF_TEMPLATES = new Set(['dmm-08', 'dmm-09']);
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
  const current: any = await prisma.digitalMarketingTaskLog.findUnique({ where: { id: logId } });
  if (!current) throw new Error('task log not found');
  let remark: string | null = input.remark !== undefined
    ? (input.remark ? String(input.remark).slice(0, 2000) : null)
    : (current.remark ?? null);
  if (status !== String(current.status) && !remark?.trim()) {
    if (String(current.remark || '').trim()) remark = current.remark; // preserve recorded reason
    else throw new Error('A remark (reason) is required to change status');
  }
  const data: Record<string, any> = { status, remark, updatedBy: actor };
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
  // Structured metrics for daily numeric tasks (Meta/B2B/Whatsapp/Email).
  if (input.metricsJson !== undefined) {
    if (input.metricsJson === null || input.metricsJson === '') data.metricsJson = null;
    else {
      let obj: any = input.metricsJson;
      if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { throw new Error('metricsJson must be valid JSON'); } }
      if (typeof obj !== 'object' || Array.isArray(obj) || !obj) throw new Error('metricsJson must be object');
      // Sanitize: numbers 0-1e9, text up to 500 chars per field.
      const clean: Record<string, any> = {};
      for (const [k, v] of Object.entries(obj as Record<string, any>)) {
        const key = String(k).slice(0, 50);
        if (v === null || v === '' || v === undefined) { clean[key] = null; continue; }
        if (typeof v === 'number') clean[key] = Number.isFinite(v) ? Math.floor(Number(v)) : null;
        else if (!isNaN(Number(String(v).trim())) && String(v).trim() !== '' && /^[-0-9.]+$/.test(String(v).trim())) clean[key] = Math.max(0, Math.floor(Number(String(v).trim())));
        else clean[key] = String(v).slice(0, 500);
      }
      data.metricsJson = JSON.stringify(clean);
    }
  }
  // Whatsapp / Email marketing proof gate: Done requires (1) the data-source
  // field filled (which list was used) and (2) ≥1 proof attachment.
  // dataSource may arrive in this PATCH or already be stored on the log.
  if (status === 'done' && MARKETING_PROOF_TEMPLATES.has(String((current as any).templateId))) {
    let merged: Record<string, any> = {};
    try { merged = current.metricsJson ? JSON.parse(String(current.metricsJson)) : {}; } catch { merged = {}; }
    if (data.metricsJson) {
      try { merged = { ...merged, ...JSON.parse(String(data.metricsJson)) }; } catch { /* keep stored */ }
    }
    const ds = String((merged as any).dataSource ?? '').trim();
    if (!ds) throw new Error('Write which data was used for marketing (Data used field) before marking Done');
    const proofs = await (prisma as any).digitalMarketingTaskAttachment.count({ where: { logId } }).catch(() => 0);
    if (!proofs || Number(proofs) < 1) throw new Error('Attach the marketing data as proof before marking Done');
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
      const acc: any = await prisma.digitalMarketingManager.findUnique({ where: { id: String(data.accountantId) } });
      if (!acc || acc.deleted) {
        if (status === 'done' && !data.doneBy && acc?.name) data.doneBy = String(acc.name).slice(0, 200);
        data.accountantId = null;
      } else if (status === 'done' && !data.doneBy && acc.name) {
        data.doneBy = String(acc.name).slice(0, 200);
      }
    } catch { /* keep the id on read failure */ }
  }
  const row = await prisma.digitalMarketingTaskLog.update({ where: { id: logId }, data });
  await invalidateDigitalMarketingCache();
  return row;
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
    url: `/api/digital-marketing/files/${String(row?.id ?? '')}`,
  };
}

export async function createAttachmentRecord(input: {
  logId: string; fileName: string; mime: string; size: number; kvKey: string; uploadedBy: string | null;
}) {
  const log: any = await prisma.digitalMarketingTaskLog.findUnique({ where: { id: input.logId } });
  if (!log) throw new Error('task log not found');
  const row = await (prisma as any).digitalMarketingTaskAttachment.create({
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
  await invalidateDigitalMarketingCache();
  return row;
}

export async function getAttachment(id: string) {
  return (prisma as any).digitalMarketingTaskAttachment.findUnique({ where: { id } });
}

export async function deleteAttachmentRecord(id: string) {
  const row: any = await (prisma as any).digitalMarketingTaskAttachment.findUnique({ where: { id } });
  if (!row) throw new Error('Attachment not found');
  await (prisma as any).digitalMarketingTaskAttachment.delete({ where: { id } });
  await invalidateDigitalMarketingCache();
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
  const roster = (pre?.roster ?? await prisma.digitalMarketingManager.findMany({
    where: { deleted: false }, orderBy: { order: 'asc' },
  })) as any[];
  const [doneLogs, todayLogs] = await Promise.all([
    (prisma as any).digitalMarketingTaskLog.findMany({
      where: { status: 'done', dueDate: { gte: monthStart } },
      select: { accountantId: true, doneBy: true, dueDate: true },
    }).catch(() => []),
    pre?.todayLogs ?? prisma.digitalMarketingTaskLog.findMany({
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
  const openByRole = { manager: 0 };
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
    const role = String(l.template?.ownerRole || 'either');
    if (role === 'manager' || role === 'either') openByRole.manager += 1;
  }
  const completionPct = doneToday + openToday > 0 ? Math.round((doneToday / (doneToday + openToday)) * 100) : 100;
  const members = roster.map((r) => {
    const c = credit.get(String(r.id))!;
    const lane = openByRole.manager;
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
    overdueToday: overdueToday + (carried ? carried.size : 0),
    completionPct, weekDone, monthDone,
    members,
  };
}
