function utcNoon(date: string): number {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addCalendarDays(date: string, n: number): string {
  return fromUtc(utcNoon(date) + n * 86400000);
}

export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  if (!start || !end || end < start) return out;
  for (let t = utcNoon(start); t <= utcNoon(end); t += 86400000) out.push(fromUtc(t));
  return out;
}

export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = String(month).slice(0, 7).split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const end = fromUtc(Date.UTC(y, m, 0, 12));
  return { start, end };
}

export function monthDates(month: string): string[] {
  const { start, end } = monthRange(month);
  return eachDate(start, end);
}

export function isWeeklyOff(date: string): boolean {
  return new Date(utcNoon(date)).getUTCDay() === 0;
}

export function workingDatesInRange(start: string, end: string, holidays: Set<string>): string[] {
  void holidays;
  return eachDate(start, end).filter((d) => !isWeeklyOff(d));
}

export function leaveWorkingDays(start: string, end: string, holidays: Set<string>): number {
  return eachDate(start, end).filter((d) => !isWeeklyOff(d) && !holidays.has(d)).length;
}

export function clampRange(start: string, end: string, min: string, max: string): { start: string; end: string } | null {
  const s = start > min ? start : min;
  const e = end < max ? end : max;
  return s <= e ? { start: s, end: e } : null;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
    .format(new Date(Date.UTC(y, m - 1, 1, 12)));
}
