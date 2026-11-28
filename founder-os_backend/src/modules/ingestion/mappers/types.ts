// mappers/types.ts — the mapper contract + the field-reading helpers every
// mapper shares. Pure: no I/O, no env, usable in guards.

import type { MapperResult } from '../types';

export interface MapperContext {
  source: string;
  instanceKey: string;
  receivedAt: string;
}

export type Mapper = (payload: Record<string, any>, ctx: MapperContext) => MapperResult;

export function text(value: unknown, max = 400): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function isoOrNow(value: unknown, fallback: string): string {
  const raw = text(value, 60);
  if (!raw) return fallback;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

export function amount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value ?? '').replace(/[^0-9.\-]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeKeys(payload: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(payload ?? {})) out[k.toLowerCase()] = v;
  return out;
}

/** First non-empty value among `keys`, case-insensitively. */
export function pick(payload: Record<string, any>, keys: string[]): any {
  const norm = normalizeKeys(payload);
  for (const key of keys) {
    const hit = norm[key.toLowerCase()];
    if (hit !== undefined && hit !== null && String(hit).trim() !== '') return hit;
  }
  return '';
}

/** Same, but also looks inside `data` / `lead` / `enquiry` sub-objects. */
export function pickDeep(payload: Record<string, any>, keys: string[]): any {
  const direct = pick(payload, keys);
  if (direct !== '') return direct;
  for (const name of ['data', 'lead', 'enquiry', 'payload']) {
    const nested = payload?.[name];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const hit = pick(nested as Record<string, any>, keys);
      if (hit !== '') return hit;
    }
  }
  return '';
}

/** Only http(s) survives: a portal must never plant a javascript: URL. */
export function safeUrl(value: unknown): string {
  const raw = text(value, 1000);
  return /^https?:\/\//i.test(raw) ? raw : '';
}

export function withoutLead(result: MapperResult): MapperResult {
  return { ...result };
}
