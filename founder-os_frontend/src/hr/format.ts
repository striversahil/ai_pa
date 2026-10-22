const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()).slice(0, 10);
}

export function currentMonthIST(): string {
  return todayIST().slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1, 12));
  return dt.toISOString().slice(0, 7);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1] ?? month} ${y}`;
}

/** "2026-10-21" → "Wed, 21 Oct" (no year; due dates are near-term). */
export function dateLabel(date: string | null): string {
  if (!date) return "No date";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return `${WEEKDAYS[dt.getUTCDay()]}, ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

/** "14:30" → "2:30 PM"; null → "". */
export function timeLabel(time: string | null): string {
  if (!time) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${m[2]} ${suffix}`;
}

export function money(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function initials(name: string | null | undefined): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

/** Default expense date inside the selected month (today when viewing this month). */
export function defaultDateForMonth(month: string): string {
  const today = todayIST();
  return today.slice(0, 7) === month ? today : `${month}-01`;
}

export function isOwnExpense(createdBy: string | null, me: { user: { email: string; name: string } } | null, canManage: boolean): boolean {
  if (canManage) return true;
  if (!createdBy || !me) return false;
  return createdBy === me.user.name || createdBy === me.user.email;
}


/** Quantity with up to 3 decimals, e.g. 12.5 kg. */
export function qty(n: number | null | undefined, unit: string): string {
  const v = Number(n) || 0;
  return `${v.toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${unit || "pcs"}`;
}

export function hoursLabel(hours: number | null | undefined): string {
  const h = Number(hours) || 0;
  return `${h.toLocaleString("en-IN", { maximumFractionDigits: 2 })} hrs`;
}

export function shiftDate(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta, 12)).toISOString().slice(0, 10);
}

export function isSunday(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() === 0;
}

export function shortDate(date: string | null): string {
  if (!date) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
