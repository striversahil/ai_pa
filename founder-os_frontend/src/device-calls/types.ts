// Device call-log views (mirrors the worker response shapes).
export type CallSource = "neodove" | "manual" | "device";

export interface DeviceCall {
  id: string;
  telecallerId: string;
  agentName: string;
  deviceLabel: string;
  direction: string;
  number: string;
  contactName: string;
  attemptAt: string;
  connectAt: string | null;
  endAt: string | null;
  status: string;
  callLogType: number | null;
  durationSec: number;
  ringSec: number;
  day: string;
  audioSource: string;
  recordingState: string;
  recordingBytes: number;
  hasRecording: boolean;
}

export interface CallTotals {
  attempts: number;
  connected: number;
  missed: number;
  rejected: number;
  blocked: number;
  failed: number;
  talkSec: number;
  connectRate: number;
  repeatedNumbers: number;
}

export interface DeviceRow {
  id: string;
  telecallerId: string;
  deviceId: string;
  label: string;
  status: "active" | "revoked";
  loggingOnly: number;
  consentAt: string | null;
  lastSeenAt: string | null;
  appVersion: string;
  createdAt: string;
  agentName: string | null;
  region: string | null;
}

export interface CallFilters {
  from: string;
  to: string;
  agentId?: string;
  direction?: string;
  status?: string;
  q?: string;
}
