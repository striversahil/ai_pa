// Extracted verbatim from ManualCallsPanel.tsx by scripts/refactor/split-module.mjs.
// ManualCallsPanel.tsx re-exports everything public here, so existing imports keep working.


export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function istToday(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
