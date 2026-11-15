// personal/rewards.ts — local-only v1 rewards (streaks of days with a Done).
//
// Honest scoping: server-derived streaks (from core_action_event COMPLETED
// history) are the follow-up — that needs a read endpoint. Until then the
// ring counts days the holder tapped Done in THIS browser (localStorage), so
// it can never disagree with server truth, only under-count it.
const KEY = "pw-done-days";

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((d) => typeof d === "string") : [];
  } catch { return []; }
}

function dayStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Record a Done tap for today. Returns the updated streak. */
export function recordDoneToday(now = new Date()): number {
  const today = dayStr(now);
  const days = new Set(load());
  days.add(today);
  try { localStorage.setItem(KEY, JSON.stringify([...days].sort())); } catch { /* private mode */ }
  return streakDays(now);
}

/** Consecutive days ending today (or yesterday, if today has no Done yet). */
export function streakDays(now = new Date()): number {
  const have = new Set(load());
  let streak = 0;
  const cursor = new Date(now);
  if (!have.has(dayStr(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (have.has(dayStr(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  return streak;
}
