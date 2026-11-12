// Extracted verbatim from NeodoveTelecallerDashboard.tsx by scripts/refactor/split-module.mjs.
// NeodoveTelecallerDashboard.tsx re-exports everything public here, so existing imports keep working.
import type { PresetKey, TrafficLight } from "./types";

export const REFRESH_MS = 5 * 60 * 1000;

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today (live)" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This Week" },
  { key: "last_week", label: "Last Week" },
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "last_7_days", label: "Last 7 Days" },
  { key: "last_30_days", label: "Last 30 Days" },
  { key: "all_time", label: "All Time" },
  { key: "custom", label: "Custom Range…" },
];

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()).slice(0, 10);
}

export function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

export function computeRange(preset: PresetKey, customFrom: string, customTo: string): { from?: string; to?: string } {
  const today = istToday();
  switch (preset) {
    case "today": return { from: today, to: today };
    case "yesterday": { const y = addDays(today, -1); return { from: y, to: y }; }
    case "this_week": {
      const [y, m, d] = today.split("-").map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
      return { from: addDays(today, -((dow + 6) % 7)), to: today }; // Mon → today
    }
    case "last_week": {
      const [y, m, d] = today.split("-").map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      const mon = addDays(today, -((dow + 6) % 7));
      return { from: addDays(mon, -7), to: addDays(mon, -1) };
    }
    case "this_month": return { from: `${today.slice(0, 8)}01`, to: today };
    case "last_month": {
      const firstOfThisMonth = `${today.slice(0, 8)}01`;
      const lastOfPrev = addDays(firstOfThisMonth, -1);
      return { from: `${lastOfPrev.slice(0, 8)}01`, to: lastOfPrev };
    }
    case "last_7_days": return { from: addDays(today, -6), to: today };
    case "last_30_days": return { from: addDays(today, -29), to: today };
    case "all_time": return { from: "2020-01-01", to: today };
    case "custom":
      if (DATE_RE.test(customFrom) && DATE_RE.test(customTo)) {
        return customFrom <= customTo ? { from: customFrom, to: customTo } : { from: customTo, to: customFrom };
      }
      return {};
  }
}

export function fmtRangeLabel(from?: string | null, to?: string | null): string {
  if (!from && !to) return "";
  if (from === to) return from!;
  return `${from} – ${to}`;
}

export const LIGHT_TEXT: Record<TrafficLight, string> = {
  green: "text-emerald-400",
  amber: "text-amber-400",
  red: "text-rose-400",
};

export const LIGHT_BG: Record<TrafficLight, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
};

export const LIGHT_CHIP: Record<TrafficLight, string> = {
  green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  red: "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

export function fmtTalkTime(sec: number): string {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function fmtNum(n: number | undefined): string {
  return n === undefined || n === null ? "—" : String(n);
}
