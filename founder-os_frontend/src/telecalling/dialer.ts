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

/** Sales-head scheduled break (IST HH:MM); agents empty = everyone. Phone locks the dialer inside it. */
export interface ScheduledBreak {
  id: string;
  label: string;
  start: string;
  end: string;
  agents: string[];
}

export interface DialerConfig {
  dispositionSec: number;
  nextCallSec: number;
  shiftStart: string;
  shiftEnd: string;
  retryGapMin: number;
  retryMax: number;
  /** mirror: backend modules/dialer/types.ts — talk time ≥ this closes the lead even on a retry disposition. */
  connectedMinSec: number;
  /** mirror: backend types.ts — minutes an agent may pause dialing after a call ("Lead time"), 0 = off. */
  leadTimeMin: number;
  /** mirror: backend types.ts — follow-ups/callbacks at most this many days ahead. */
  followUpMaxDays: number;
  dispositions: Disposition[];
  breakReasons: BreakReason[];
  scheduledBreaks: ScheduledBreak[];
  /** Also report calls made/received in the phone's own dialer. */
  trackPhoneCalls: boolean;
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
  /** Calls from the phone's own dialer (call log). */
  phone: number;
  flagged: number;
  hours: Record<string, HourCell>;
  dispositions: Record<string, number>;
  breaks: Array<{ reason: string; startAt: string; endAt: string | null; durationSec: number; overrunSec: number; note: string }>;
  breakSec: number;
}

export type CallSource = "manual" | "device";

/** One call row from /api/call-log/calls (backend mirror: modules/device-calls/store.ts `view`). */
export interface RecordedCall {
  id: string;
  telecallerId: string;
  agentName: string;
  number: string;
  contactName: string;
  attemptAt: string;
  durationSec: number;
  recordingBytes: number;
  hasRecording: boolean;
  disposition: string;
  remarks: string;
  manual: boolean;
}

/** A lead that hit the retry cap and stopped re-queuing (backend: dialer/queue.ts listUnreachable). */
export interface UnreachableLead {
  id: string;
  telecallerId: string;
  agentName: string;
  mobile: string;
  name: string;
  attempts: number;
  lastDisposition: string;
  updatedAt: string;
}

/** A dialer push batch (backend mirror: modules/dialer/types.ts DialerBatchView). */
export interface DialerBatch {
  batchId: string;
  createdAt: string;
  region: string;
  state: string;
  requestedByName: string;
  agents: number;
  total: number;
  waiting: number;
  worked: number;
  removed: number;
}

/** Break key the phone logs for "Lead time" (backend LEAD_TIME_REASON). */
export const LEAD_TIME_REASON = "LEAD_TIME";

/** Label for a break reason key, including the phone's own Lead time pause. */
export function breakLabel(config: DialerConfig | null, key: string): string {
  if (key === LEAD_TIME_REASON) return "Lead time";
  return config?.breakReasons.find((b) => b.key === key)?.label ?? key;
}

/** Latest phone app build (backend mirror: modules/dialer/app-release.ts AppRelease). */
export interface AppRelease {
  available: boolean;
  versionName: string;
  versionCode: number;
  sizeBytes: number;
  /** Signed with the shared key: updates install over the old app, pairing kept. */
  stableKey: boolean;
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
  /** Clean slate for an agent: queue recalled, open breaks closed, status idle; wipeToday also deletes today's calls/breaks/recordings. */
  reset: (telecallerId: string, wipeToday: boolean) =>
    call<{ recalled: number; breaksClosed: number; callsDeleted: number; breaksDeleted: number; recordingsDeleted: number }>(
      `/api/dialer/agents/${encodeURIComponent(telecallerId)}/reset`, json("POST", { wipeToday })),
  revokeDevice: (deviceId: string) => call<{ ok: boolean }>(`/api/call-log/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" }),
  callSource: () => call<{ mode: CallSource }>("/api/dialer/call-source"),
  setCallSource: (mode: CallSource) => call<{ mode: CallSource }>("/api/dialer/call-source", json("PUT", { mode })),
  app: () => call<AppRelease>("/api/dialer/app"),
  batches: (days = 30) => call<{ batches: DialerBatch[] }>(`/api/dialer/batches?days=${days}`),
  /** Whole batch off every agent's dialer (waiting leads only; calls made stay). */
  removeBatch: (batchId: string) => call<{ removed: number }>(`/api/dialer/batches/${encodeURIComponent(batchId)}/remove`, json("POST", {})),
  unreachable: (days = 7) => call<{ items: UnreachableLead[] }>(`/api/dialer/unreachable?days=${days}`),
  /** Calls with audio in storage for one IST day (shared call-log route, managers see all agents). */
  recordings: (day: string) =>
    call<{ calls: RecordedCall[] }>(`/api/call-log/calls?from=${encodeURIComponent(day)}&to=${encodeURIComponent(day)}&recorded=1&limit=500`),
};

/** Streams a recording (Range-capable) — `download` forces a file save. */
export function recordingUrl(callId: string, download = false): string {
  return `/api/call-log/recording/${encodeURIComponent(callId)}${download ? "?download=1" : ""}`;
}

export const LIVE_STATE_LABEL: Record<string, string> = {
  idle: "Idle",
  dialing: "Dialing",
  on_call: "On call",
  disposition: "In disposition",
  lead_time: "Lead time",
  break: "On break",
  manual: "Manual dial",
  paused: "Paused",
  off_shift: "Off shift",
  offline: "Offline",
};

/** Severity for the state chip: calling = good, break/idle = watch, offline = bad. */
export function stateTone(state: string): "good" | "watch" | "bad" {
  if (state === "on_call" || state === "dialing" || state === "disposition" || state === "lead_time" || state === "manual") return "good";
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
