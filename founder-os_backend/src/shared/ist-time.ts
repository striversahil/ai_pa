const KOLKATA_TZ = 'Asia/Kolkata';
const KOLKATA_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export interface KolkataDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function getKolkataParts(date: Date): KolkataDateTime {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: KOLKATA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  return { year: get('year'), month: get('month'), day: get('day'), hour, minute: get('minute'), second: get('second') };
}

export function getKolkataHour(date: Date = new Date()): number {
  return getKolkataParts(date).hour;
}

/**
 * Returns the UTC instant of 00:00 IST (Asia/Kolkata) for the calendar day
 * that `now` falls on. Used for "created today" boundaries so they align with
 * IST, not the process/host timezone.
 */
export function kolkataDayStartUtc(now: Date = new Date()): Date {
  const p = getKolkataParts(now);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0) - KOLKATA_OFFSET_MS);
}

/**
 * Returns the UTC instant of the next occurrence of `targetHour:00` in Asia/Kolkata
 * strictly after `now` (rolls to the following day if already past).
 */
export function nextKolkataTimeUtc(now: Date, targetHour: number): Date {
  const p = getKolkataParts(now);
  const target = new Date(Date.UTC(p.year, p.month - 1, p.day, targetHour, 0, 0) - KOLKATA_OFFSET_MS);
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target;
}
