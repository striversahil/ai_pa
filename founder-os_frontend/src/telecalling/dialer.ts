// dialer.ts — Controller side of the Founder OS auto dialer: shapes, API
// calls and pure helpers. Components never fetch; they go through here.
//
// Backend mirror: founder-os_backend/src/modules/dialer/types.ts (config,
// dispositions, break reasons) — keep names and semantics identical.

export interface Disposition {
  key: string;
  label: string;
  connected: boolean;
  retry: boolean;
  callback: boolean;
}

export interface BreakReason {
  key: string;
  label: string;
  maxMin: number;
  needsNote: boolean;
}

export interface DialerConfig {
  dispositionSec: number;
  nextCallSec: number;
  shiftStart: string;
  shiftEnd: string;
  retryGapMin: number;
  retryMax: number;
  dispositions: Disposition[];
  breakReasons: BreakReason[];
  updatedAt: string;
  updatedBy: string;
}

export interface PairRequest {
  id: string;
  code: string;
  deviceId: string;
  label: string;
  agentHint: string;
  appVersion: string;
  createdAt: string;
  expiresAt: string;
}

export interface OpenBreak { reason: string; startAt: string; durationSec: number; overrunSec: number }

export interface BoardRow {
  deviceId: string;
  telecallerId: string;
  agentName: string;
  region: string;
  label: string;
  appVersion: string;
  lastSeenAt: string | null;
  liveState: string;
  liveDetail: string;
  pendingSync: number;
  queueDue: number;
  queueLater: number;
  attempted: number;
  connected: number;
  talkSec: number;
  breakSec: number;
  openBreak: OpenBreak | null;
}

export interface HourCell { attempted: number; connected: number; talkSec: number }

export interface AgentDay {
  telecallerId: string;
  name: string;
  region: string;
  attempted: number;
  connected: number;
  talkSec: number;
  manual: number;
  flagged: number;
  hours: Record<string, HourCell>;
  dispositions: Record<string, number>;
  breaks: Array<{ reason: string; startAt: string; endAt: string | null; durationSec: number; overrunSec: number; note: string }>;
  breakSec: number;
}

export type CallSource = "neodove" | "manual" | "device";

/** Latest phone app build (backend mirror: modules/dialer/app-release.ts AppRelease). */
export interface AppRelease {
  available: boolean;
  versionName: string;
  versionCode: number;
  sizeBytes: number;
  builtAt: string | null;
  commit: string;
  /** Same-origin Founder OS route that streams the APK. */
  downloadUrl: string;
}

/** Live-event filter for every dialer read (backend LiveEvent.DeviceCalls). */
export const DIALER_EVENTS = ["device-calls"];

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error || `Request failed (${res.status})`);
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const dialerApi = {
  pairRequests: () => call<{ requests: PairRequest[] }>("/api/dialer/pair-requests"),
  approve: (id: string, telecallerId: string) =>
    call<{ ok: boolean; agentName: string }>(`/api/dialer/pair-requests/${encodeURIComponent(id)}/approve`, json("POST", { telecallerId })),
  reject: (id: string) => call<{ ok: boolean }>(`/api/dialer/pair-requests/${encodeURIComponent(id)}/reject`, json("POST", {})),
  board: () => call<{ agents: BoardRow[]; config: DialerConfig }>("/api/dialer/board"),
  report: (day: string) => call<{ day: string; agents: AgentDay[]; config: DialerConfig }>(`/api/dialer/report?day=${encodeURIComponent(day)}`),
  config: () => call<{ config: DialerConfig }>("/api/dialer/config"),
  saveConfig: (cfg: DialerConfig) => call<{ config: DialerConfig }>("/api/dialer/config", json("PUT", cfg)),
  recall: (telecallerId: string) => call<{ recalled: number }>("/api/dialer/queue/recall", json("POST", { telecallerId })),
  revokeDevice: (deviceId: string) => call<{ ok: boolean }>(`/api/call-log/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" }),
  callSource: () => call<{ mode: CallSource }>("/api/telecalling/manual-calls/mode"),
  setCallSource: (mode: CallSource) => call<{ mode: CallSource }>("/api/telecalling/manual-calls/mode", json("PUT", { mode })),
  app: () => call<AppRelease>("/api/dialer/app"),
};

export const LIVE_STATE_LABEL: Record<string, string> = {
  idle: "Idle",
  dialing: "Dialing",
  on_call: "On call",
  disposition: "In disposition",
  break: "On break",
  manual: "Manual dial",
  paused: "Paused",
  off_shift: "Off shift",
  offline: "Offline",
};

/** Severity for the state chip: calling = good, break/idle = watch, offline = bad. */
export function stateTone(state: string): "good" | "watch" | "bad" {
  if (state === "on_call" || state === "dialing" || state === "disposition" || state === "manual") return "good";
  if (state === "offline") return "bad";
  return "watch";
}

/** 754s → "12m 34s"; 3700s → "1h 1m". */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

/** Today in IST as YYYY-MM-DD (the report's day key). */
export function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** "R1_NEW" style key from a label (mirror of backend `toKey`). */
export function toKey(label: string): string {
  return String(label ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

/** Hours (IST) that have any calls across the given agents, ascending. */
export function activeHours(agents: AgentDay[]): number[] {
  const set = new Set<number>();
  for (const a of agents) for (const h of Object.keys(a.hours)) set.add(Number(h));
  return [...set].sort((x, y) => x - y);
}

export function hourLabel(h: number): string {
  const suffix = h < 12 ? "am" : "pm";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${suffix}`;
}
