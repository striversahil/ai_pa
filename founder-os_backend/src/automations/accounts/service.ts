import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { cached, cacheDel } from '../../shared/cache';

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
export const OWNER_ROLES = ['senior', 'junior', 'either'] as const;
export const LOG_STATUSES = ['pending', 'done', 'skipped', 'overdue'] as const;

const DATA_TTL_MS = 60 * 1000;
const DATA_CACHE_PREFIX = 'accounts:dashboard:';

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
  const templates = await prisma.accountsTaskTemplate.findMany({ where: { active: true } });
  const due = templates.filter((t: any) => isDueOn(t, dateStr));
  if (due.length === 0) return 0;
  const existing = await prisma.accountsTaskLog.findMany({
    where: { dueDate: dateStr, templateId: { in: due.map((t: any) => t.id) } },
    select: { templateId: true },
  });
  const have = new Set((existing as any[]).map((r) => String(r.templateId)));
  let created = 0;
  for (const t of due as any[]) {
    if (have.has(String(t.id))) continue;
    try {
      await prisma.accountsTaskLog.create({ data: { templateId: t.id, dueDate: dateStr, status: 'pending' } });
      created++;
    } catch { /* unique race — ignore */ }
  }
  return created;
}

/** Mark stale pending rows overdue (materialised reminder state). */
export async function flagOverdue(todayStr: string): Promise<number> {
  const stale = await prisma.accountsTaskLog.findMany({
    where: { dueDate: { lt: todayStr }, status: 'pending' },
    select: { id: true },
    take: 500,
  });
  let n = 0;
  for (const r of stale as any[]) {
    try {
      await prisma.accountsTaskLog.update({ where: { id: r.id }, data: { status: 'overdue' } });
      n++;
    } catch { /* ignore */ }
  }
  return n;
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

async function computeDashboard(dateStr: string) {
  await ensureInstances(dateStr);
  const [roster, templates, logs] = await Promise.all([
    prisma.accountant.findMany({ where: { deleted: false }, orderBy: { order: 'asc' } }),
    prisma.accountsTaskTemplate.findMany({ where: { active: true }, orderBy: { order: 'asc' } }),
    prisma.accountsTaskLog.findMany({
      where: { dueDate: dateStr },
      include: { template: true, accountant: true },
    }),
  ]);
  const byTemplate = new Map((logs as any[]).map((l) => [String(l.templateId), l]));
  const active = (templates as any[]).filter((t) => !UNSCHEDULED_RULES.has(String(parseRule(t)?.type ?? t.ruleType ?? '')));
  // Include due-but-not-yet-instantiated templates defensively.
  const items = active
    .filter((t) => isDueOn(t, dateStr))
    .map((t) => {
      const log = byTemplate.get(String(t.id));
      const status = log?.status ?? 'pending';
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
        logId: log?.id ?? null,
        status,
        remark: log?.remark ?? null,
        doneBy: log?.doneBy ?? null,
        accountantId: log?.accountantId ?? null,
        accountantName: log?.accountant?.name ?? null,
        updatedAt: log?.updatedAt ?? null,
        overdue: status === 'overdue' || (status === 'pending' && String(dateStr) < istDateStr()),
      };
    });
  const overdueCount = items.filter((i) => i.overdue && i.status !== 'done' && i.status !== 'skipped').length;
  const openCount = items.filter((i) => i.status === 'pending' || i.status === 'overdue').length;
  const doneCount = items.filter((i) => i.status === 'done').length;
  const split = (role: string) => items.filter((i) => i.ownerRole === role || i.ownerRole === 'either');
  // Reference tasks with no fixed date (variable_per_item / to_be_decided):
  // always visible, never auto-instantiated, never overdue.
  const unscheduled = (templates as any[])
    .filter((t) => UNSCHEDULED_RULES.has(String(parseRule(t)?.type ?? t.ruleType ?? '')))
    .map((t) => ({
      templateId: t.id,
      title: t.title,
      description: t.description,
      frequency: t.frequency,
      ownerRole: t.ownerRole,
      ruleType: t.ruleType ?? parseRule(t)?.type ?? null,
      note: (() => { try { return JSON.parse(String(t.ruleJson || '{}')).note ?? null; } catch { return null; } })(),
      dueLabel: t.rawText ?? null,
    }));
  return {
    meta: {
      date: dateStr,
      today: istDateStr(),
      total: items.length,
      open: openCount,
      done: doneCount,
      overdue: overdueCount,
      generatedAt: new Date().toISOString(),
    },
    roster: (roster as any[]).map((r) => ({
      id: r.id, name: r.name, email: r.email, phone: r.phone, role: r.role, order: r.order,
    })),
    senior: split('senior'),
    junior: split('junior'),
    items,
    unscheduled,
  };
}

export async function getAccountsDashboardData(query: Record<string, any> = {}) {
  const date = String(query.date || '').slice(0, 10) || istDateStr();
  return cached(`${DATA_CACHE_PREFIX}${date}`, DATA_TTL_MS, () => computeDashboard(date));
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
  if (input.active !== undefined) data.active = !!input.active;
  if (input.order !== undefined) data.order = Number(input.order);
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

// ── Logging (taskbar write: status + remark) ─────────────────────────────────
export async function logTask(logId: string, input: Record<string, any>, actor: string | null) {
  const status = String(input.status || '');
  if (!['pending', 'done', 'skipped'].includes(status)) throw new Error('status must be pending|done|skipped');
  const data: Record<string, any> = { status, updatedBy: actor };
  if (input.remark !== undefined) data.remark = input.remark ? String(input.remark).slice(0, 2000) : null;
  if (input.doneBy !== undefined) data.doneBy = input.doneBy ? String(input.doneBy).slice(0, 200) : null;
  if (input.accountantId !== undefined) data.accountantId = input.accountantId ? String(input.accountantId) : null;
  const row = await prisma.accountsTaskLog.update({ where: { id: logId }, data });
  await invalidateAccountsCache();
  return row;
}
