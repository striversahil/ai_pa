// pure.ts — request validation for the Customer push (no I/O).
import type { Distribution } from './types';

/** Domain failure with an HTTP status the route can pass through. */
export class PushError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'PushError';
    this.status = status;
  }
}

export const REGIONS = ['R1', 'R2', 'R3', 'R4'] as const;

export function normalizeRegion(raw: unknown): string {
  const value = String(raw ?? '').trim().toUpperCase();
  if (!REGIONS.includes(value as any)) throw new PushError('region must be one of R1, R2, R3, R4');
  return value;
}

export function normalizeState(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) throw new PushError('state is required');
  return value.slice(0, 120);
}

export function normalizeDistrict(raw: unknown): string {
  return String(raw ?? '').trim().slice(0, 120);
}

/** '' = all types; otherwise one customerTypeBase family. */
export function normalizeClientType(raw: unknown): string {
  return String(raw ?? '').trim().slice(0, 120);
}

export function normalizeDistribution(raw: unknown): Distribution {
  return String(raw ?? '').trim() === 'single' ? 'single' : 'split';
}

export function normalizeAgentKey(raw: unknown): string {
  return String(raw ?? '').trim().slice(0, 120);
}

/** `cp_<base36 time><random>` — sortable enough for a ledger id. */
export function newId(prefix = 'cp'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}
