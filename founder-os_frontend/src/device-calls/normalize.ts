// Pure API→UI mappers for the device call log.
import type { CallTotals, DeviceCall } from "./types";

export function istToday(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function monthAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function fmtDuration(sec: number): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export function fmtTalk(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

export function fmtTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function emptyTotals(): CallTotals {
  return { attempts: 0, connected: 0, missed: 0, rejected: 0, blocked: 0, failed: 0, talkSec: 0, connectRate: 0, repeatedNumbers: 0 };
}

export function displayNumber(call: DeviceCall): string {
  return call.contactName?.trim() || call.number || "Unknown";
}
