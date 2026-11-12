// Extracted verbatim from service.ts by scripts/refactor/split-module.mjs.
// service.ts re-exports everything public here, so existing imports keep working.
import type { PaymentAttachment, PaymentDueRow, PaymentBucket, PaymentSummary } from "./types";

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

export const DATA_TTL_MS = 5 * 60 * 1000;

// v2: payload rows for shared templates split per lane (slot). Bump on any
// dashboard-shape change so stale KV never serves the old row layout.
export const DATA_CACHE_PREFIX = 'accounts:dashboard:v2:';

/** Due-projection signature (Phase 5a mirror gate). The accounts read path
 *  projects dues into core_receipt; identical dues must not re-write ~180 rows
 *  on every cache miss, and the TTL is also the self-heal window for core rows
 *  changed outside this path. */
export const DUES_SIG_KEY = 'accounts:dues:sig';
export const DUE_SYNC_TTL_MS = 30 * 60 * 1000;

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

export function parseDay(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

export function fmtDay(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ── Schedule grammar (see data/accounts_follow_up.json `date_type_legend`) ──
export const MONTH_NUM: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export const WEEKDAY_NUM: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

/** Rule types that never auto-generate dated instances (shown as reference). */
export const UNSCHEDULED_RULES = new Set(['variable_per_item', 'to_be_decided']);

export function monthNum(m: unknown): number | null {
  if (m === null || m === undefined) return null;
  if (typeof m === 'number') return m >= 1 && m <= 12 ? Math.floor(m) : null;
  return MONTH_NUM[String(m).trim().toLowerCase()] ?? null;
}

export function occurrenceMatch(occurrence: unknown, d: number, dim: number): boolean {
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

export function evalRule(rule: any, y: number, m: number, d: number, wd: number, dim: number, frequency: string): boolean {
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

export function parseRule(t: any): any | null {
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
export function isOffsetDueOn(t: any, y: number, m: number, d: number): boolean {
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

/** Legacy path for simple manager-created tasks (no ruleJson): frequency + dueDay/dueMonth. */
export function legacyDueOn(t: any, y: number, m: number, d: number, wd: number, dim: number): boolean {
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
export const WINDOW_RULES = new Set(['day_range', 'month_day_range', 'week_of_month']);

export function windowMatchToday(rule: any, t: any, y: number, m: number, d: number, wd: number, dim: number): boolean {
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

// ── Root export: past-N-days full ledger ─────────────────────────────────────
// One row per (date × due task): status, who, remark, attachment links.
// Read-only (never creates instances) — a complete view of what was
// pending / done per senior-junior lane, for the root export.
// Minutes → "1h 20m" / "45m" for the root export. NULL/0 → null.
export function fmtMins(v: unknown): string | null {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
}

export function addDays(dateStr: string, n: number): string {
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

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function normId(s: unknown): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function cleanTemplateInput(input: Record<string, any>, partial = false) {
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

export function parseRemindDays(raw: unknown): number[] {
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

export function toPaymentRow(t: any, log: any, dueDate: string, today: string, attachments: PaymentAttachment[] = []): PaymentDueRow {
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

export function toPaymentAttachment(f: any): PaymentAttachment {
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

// ── Team scoreboard (motivation: tasks done per person) ──────────────────────
export function normName(s: unknown): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const wd = dt.getUTCDay(); // 0 Sun … 6 Sat
  const back = (wd + 6) % 7; // days since Monday
  return new Date(dt.getTime() - back * 86400000).toISOString().slice(0, 10);
}
