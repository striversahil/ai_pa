// period.ts — IST week arithmetic for the Reporting Sheet.
//
// Weeks are ISO weeks (Monday–Sunday) in Asia/Kolkata, keyed 'YYYY-WNN'.
// Pure functions, no I/O — the frontend mirrors this file
// (frontend/src/reporting/period.ts) for week labels.

/** YYYY-MM-DD for a Date, read in Asia/Kolkata. */
export function istDateStr(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Parse a YYYY-MM-DD as a UTC-midnight Date (day arithmetic without TZ drift). */
export function parseDay(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
}

export function formatDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(ymd: string, n: number): string {
  const d = parseDay(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return formatDay(d);
}

/** ISO week key for a YYYY-MM-DD day. */
export function weekKeyOf(ymd: string): string {
  const d = parseDay(ymd);
  // Thursday of this week decides the ISO year.
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const thu = new Date(d);
  thu.setUTCDate(d.getUTCDate() - dow + 3);
  const year = thu.getUTCFullYear();
  // Week 1 = week with the first Thursday: find Monday of week 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4dow = (jan4.getUTCDay() + 6) % 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - jan4dow);
  const week = Math.floor((thu.getTime() - week1Mon.getTime()) / (7 * 86400000)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Monday..Sunday range for a week key. */
export function weekRange(key: string): { from: string; to: string } {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) throw new Error(`bad week key: ${key}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4dow = (jan4.getUTCDay() + 6) % 7;
  const mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - jan4dow + (week - 1) * 7);
  const from = formatDay(mon);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  return { from, to: formatDay(sun) };
}

export function currentWeekKey(now = new Date()): string {
  return weekKeyOf(istDateStr(now));
}

export function previousWeekKey(now = new Date()): string {
  return weekKeyOf(addDays(istDateStr(now), -7));
}

/** Last N week keys, newest first — the week picker. */
export function recentWeeks(n = 12, now = new Date()): string[] {
  const out: string[] = [];
  let key = currentWeekKey(now);
  for (let i = 0; i < n; i++) {
    out.push(key);
    const { from } = weekRange(key);
    key = weekKeyOf(addDays(from, -1));
  }
  return out;
}

/** Short label for the picker: "3–9 Nov (W45)". */
export function weekLabel(key: string): string {
  const { from, to } = weekRange(key);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const f = parseDay(from);
  const t = parseDay(to);
  const sameMonth = f.getUTCMonth() === t.getUTCMonth();
  const left = sameMonth ? String(f.getUTCDate()) : `${f.getUTCDate()} ${months[f.getUTCMonth()]}`;
  return `${left}–${t.getUTCDate()} ${months[t.getUTCMonth()]}`;
}
