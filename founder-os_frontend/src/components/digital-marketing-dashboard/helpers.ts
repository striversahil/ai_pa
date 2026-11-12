// Extracted verbatim from DigitalMarketingDashboard.tsx by scripts/refactor/split-module.mjs.
// DigitalMarketingDashboard.tsx re-exports everything public here, so existing imports keep working.
import type { RosterRow, PatternKey } from "./types";

export const FREQS = ["daily", "weekly", "monthly", "quarterly", "yearly"];

export function fmtSize(n: number): string {
  if (!n) return "";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}

/** Minutes → "1h 20m" / "45m" for the time-taken chip. */
export function fmtDur(mins: number | null | undefined): string | null {
  if (mins === null || mins === undefined) return null;
  const n = Math.floor(Number(mins));
  if (!Number.isFinite(n) || n <= 0) return null;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m}m`;
}

/** "2026-09-15" → "15 Sep" for missed-day chips. */
export function fmtShort(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
}

/** Match the signed-in user to a roster entry by NAME only (never email —
 *  the team shares logins, so email can't distinguish humans). Session name,
 *  then session email local-part, each accepted only on a single clear hit.
 *  Returns "" when ambiguous — the server then credits the session name. */
export function matchSelfRoster(me: { user: { email: string; name: string } } | null, roster: RosterRow[]): string {
  if (!me) return "";
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const candidates = [norm(me.user.name || ""), norm((me.user.email || "").split("@")[0])].filter((s) => s.length >= 3);
  for (const n of candidates) {
    const hits = roster.filter((r) => {
      const rn = norm(r.name);
      return rn && (rn === n || rn.startsWith(n) || n.startsWith(rn));
    });
    if (hits.length === 1) return hits[0].id;
  }
  return "";
}

  // NOTE: nav tabs are built per-viewer as `visibleTabs` inside the component
  // (root additionally sees the Controller tab).

export function fmtToday(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const wd = WD[new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12)).getUTCDay()];
  return `${wd}, ${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}`;
}

/** CSV cell guard: quotes wrap, and a leading tab neuters Excel formula injection. */
export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? "\t" + s : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const PATTERN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const PATTERN_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const WEEKDAY_NUM: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

export const PATTERNS = [
  { key: "daily", label: "Daily (working days)" },
  { key: "weekly", label: "Weekly on a weekday" },
  { key: "monthly_fixed", label: "Monthly · one fixed day" },
  { key: "monthly_multiple", label: "Monthly · several days" },
  { key: "monthly_range", label: "Monthly · day range" },
  { key: "yearly_fixed", label: "Yearly · one fixed date" },
  { key: "yearly_range", label: "Yearly · date range" },
  { key: "week_of_month", label: "Yearly · Nth week of month" },
  { key: "multi", label: "Several fixed dates (quarterly…)" },
  { key: "tbd", label: "No fixed date (reference)" },
] as const;

export function ord(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function parseDayList(text: string): number[] | null {
  const days = [...new Set(
    text.split(/[,;\s]+/).map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 31),
  )].sort((a, b) => a - b);
  return days.length ? days : null;
}

/** Pattern form → template POST body (ruleType/ruleJson/rawText + legacy fills). */
export function buildTemplateBody(p: {
  title: string; ownerRole: string; shared: boolean; pattern: PatternKey;
  day: string; daysText: string; startDay: string; endDay: string; weekday: string;
  month: string; yDay: string; sMonth: string; sDay: string; eMonth: string; eDay: string;
  weekNum: string; occs: { month: string; day: string }[];
}): { body?: Record<string, unknown>; error?: string } {
  const title = p.title.trim();
  if (!title) return { error: "Title required" };
  const base = { title, ownerRole: p.ownerRole, isShared: p.shared };
  const day = parseInt(p.day, 10);
  const sDay = parseInt(p.startDay, 10);
  const eDay = parseInt(p.endDay, 10);
  const yDay = parseInt(p.yDay, 10);
  switch (p.pattern) {
    case "daily":
      return { body: { ...base, frequency: "daily", ruleType: "not_applicable", ruleJson: { type: "not_applicable" }, rawText: "Every working day", dueDay: null, dueMonth: null } };
    case "weekly": {
      const wn = WEEKDAY_NUM[p.weekday] ?? 4;
      return { body: { ...base, frequency: "weekly", ruleType: "weekday", ruleJson: { type: "weekday", weekday: p.weekday, occurrence: "every" }, rawText: `Every ${p.weekday}`, dueDay: wn, dueMonth: null } };
    }
    case "monthly_fixed":
      if (!Number.isInteger(day) || day < 1 || day > 31) return { error: "Day must be 1–31" };
      return { body: { ...base, frequency: "monthly", ruleType: "fixed_day", ruleJson: { type: "fixed_day", day, month: null }, rawText: `${ord(day)} of every month`, dueDay: day, dueMonth: null } };
    case "monthly_multiple": {
      const days = parseDayList(p.daysText);
      if (!days) return { error: "Enter days like 8, 11, 13" };
      const fmt = days.map(ord).join(", ").replace(/, ([^,]*)$/, " & $1");
      return { body: { ...base, frequency: "monthly", ruleType: "multiple_days", ruleJson: { type: "multiple_days", days, month: null }, rawText: `${fmt} of every month`, dueDay: days[0], dueMonth: null } };
    }
    case "monthly_range":
      if (!Number.isInteger(sDay) || !Number.isInteger(eDay) || sDay < 1 || eDay > 31 || sDay > eDay) return { error: "Range needs start ≤ end within 1–31" };
      return { body: { ...base, frequency: "monthly", ruleType: "day_range", ruleJson: { type: "day_range", start_day: sDay, end_day: eDay, month: null }, rawText: `${ord(sDay)} - ${ord(eDay)} of every month`, dueDay: sDay, dueMonth: null } };
    case "yearly_fixed":
      if (!Number.isInteger(yDay) || yDay < 1 || yDay > 31) return { error: "Day must be 1–31" };
      return { body: { ...base, frequency: "yearly", ruleType: "fixed_day", ruleJson: { type: "fixed_day", day: yDay, month: p.month }, rawText: `${ord(yDay)} ${p.month}`, dueDay: yDay, dueMonth: PATTERN_MONTHS.indexOf(p.month) + 1 } };
    case "yearly_range": {
      const sd = parseInt(p.sDay, 10);
      const ed = parseInt(p.eDay, 10);
      if (!Number.isInteger(sd) || !Number.isInteger(ed) || sd < 1 || sd > 31 || ed < 1 || ed > 31) return { error: "Both range days must be 1–31" };
      return { body: { ...base, frequency: "yearly", ruleType: "month_day_range", ruleJson: { type: "month_day_range", start: { day: sd, month: p.sMonth }, end: { day: ed, month: p.eMonth } }, rawText: `${ord(sd)} ${p.sMonth} - ${ord(ed)} ${p.eMonth}`, dueDay: sd, dueMonth: PATTERN_MONTHS.indexOf(p.sMonth) + 1 } };
    }
    case "week_of_month": {
      const w = parseInt(p.weekNum, 10);
      if (![1, 2, 3, 4, 5].includes(w)) return { error: "Week must be 1–5" };
      return { body: { ...base, frequency: "yearly", ruleType: "week_of_month", ruleJson: { type: "week_of_month", week_number: w, month: p.month }, rawText: `${ord(w)} week of ${p.month}`, dueDay: null, dueMonth: PATTERN_MONTHS.indexOf(p.month) + 1 } };
    }
    case "multi": {
      const occs = p.occs.map((o) => ({ month: o.month, day: parseInt(o.day, 10) })).filter((o) => Number.isInteger(o.day) && o.day >= 1 && o.day <= 31);
      if (!occs.length) return { error: "Add at least one valid date" };
      const distinctMonths = new Set(occs.map((o) => o.month)).size;
      const raw = occs.map((o) => `${ord(o.day)} ${o.month.slice(0, 3)}`).join(", ");
      return { body: { ...base, frequency: occs.length > 2 ? "quarterly" : "yearly", ruleType: "multi_occurrence", ruleJson: { type: "multi_occurrence", occurrences: occs.map((o) => ({ type: "fixed_day", day: o.day, month: o.month })) }, rawText: raw, dueDay: null, dueMonth: null, _months: distinctMonths } };
    }
    case "tbd":
      return { body: { ...base, frequency: "monthly", ruleType: "to_be_decided", ruleJson: { type: "to_be_decided" }, rawText: null, dueDay: null, dueMonth: null } };
  }
}
