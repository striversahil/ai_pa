// ── Device call records: shared types, limits and identity helpers ──────────
export const DIRECTIONS = new Set(['IN', 'OUT', 'UNKNOWN']);
export const STATUSES = new Set(['CONNECTED', 'MISSED', 'REJECTED', 'BLOCKED', 'FAILED', 'RINGING', 'DIALING']);
export const FINAL_STATUSES = new Set(['CONNECTED', 'MISSED', 'REJECTED', 'BLOCKED', 'FAILED']);
export const CALL_LOG_TYPES: Record<number, string> = {
  1: 'INCOMING',
  2: 'OUTGOING',
  3: 'MISSED',
  5: 'REJECTED',
  6: 'BLOCKED',
};

export const MAX_BATCH = 200;
export const MAX_RECORDING_BYTES = 30 * 1024 * 1024;

/** Phone dialers record in different formats (Samsung m4a, Lava/Unisoc amr, …). Keep the real one. */
const AUDIO_EXT: Record<string, string> = {
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac',
  'audio/amr': 'amr', 'audio/3gpp': '3gp', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg',
  'audio/opus': 'opus', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm',
};

/** Pure: request Content-Type → stored type + file extension (unknown → m4a, the old default). */
export function recordingFormat(contentType: string | null | undefined): { type: string; ext: string } {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  return AUDIO_EXT[type] ? { type, ext: AUDIO_EXT[type] } : { type: 'audio/mp4', ext: 'm4a' };
}
export const PART_MINUTES = 10;
export const MAX_CALL_MINUTES = 60;
export const PAIR_CODE_TTL_MS = 15 * 60 * 1000;
export const DEVICE_DAYS = 7;
export const RECORDING_RETENTION_DAYS = 90;

export interface DeviceRow {
  id: string;
  telecallerId: string;
  tokenHash: string;
  deviceId: string;
  label: string;
  status: string;
  loggingOnly: number;
  consentAt: string | null;
  lastSeenAt: string | null;
  appVersion: string;
  pairedBy: string;
  pairedByName: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  revokedBy: string;
}

export interface CallRow {
  id: string;
  deviceId: string;
  telecallerId: string;
  idempotencyKey: string;
  direction: string;
  numberE164: string;
  numberHash: string;
  contactName: string;
  attemptAt: string;
  ringStartAt: string | null;
  connectAt: string | null;
  endAt: string | null;
  status: string;
  callLogType: number | null;
  durationSec: number;
  ringSec: number;
  simSlot: number | null;
  day: string;
  recordingState: string;
  recordingKey: string;
  recordingBytes: number;
  recordingParts: number;
  recordingUploadedAt: string | null;
  audioSource: string;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ParsedCall {
  id: string;
  idempotencyKey: string;
  deviceId: string;
  direction: string;
  numberE164: string;
  numberHash: string;
  contactName: string;
  attemptAt: string;
  ringStartAt: string | null;
  connectAt: string | null;
  endAt: string | null;
  status: string;
  callLogType: number | null;
  durationSec: number;
  ringSec: number;
  simSlot: number | null;
  day: string;
  recordingState: string;
  recordingParts: number;
  audioSource: string;
}

export function istDay(iso: string | Date): string {
  const ms = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
  const shifted = new Date(ms + 5.5 * 3600_000);
  return shifted.toISOString().slice(0, 10);
}
