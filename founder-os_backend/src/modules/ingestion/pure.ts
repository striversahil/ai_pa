// pure.ts — sync-only inbound normalization + signature verification.
// Imports nothing but the types: usable from guards, Workers and runners.

import { getProviderManifest, idempotencyFor, verificationFor } from '../integrations/gateway/manifest';
import type { IngestSource } from './types';

export function isIngestSource(value: string): value is IngestSource {
  const manifest = getProviderManifest(String(value));
  return !!manifest?.inbound.supported;
}

export function headerValue(headers: Record<string, string> | undefined, name: string): string {
  const wanted = name.toLowerCase();
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === wanted) return String(v ?? '');
  }
  return '';
}

/** `messages.0.id` and `entry[0].changes[0].value` — arrays and objects alike. */
export function getPath(root: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: any = root;
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = Array.isArray(cur) && /^\d+$/.test(part) ? cur[Number(part)] : cur[part];
  }
  return cur;
}

/** `custom:erp` → base `custom`, slug `erp`. */
export function parseSourceKey(source: string): { base: string; slug: string } {
  const [base, ...rest] = String(source ?? '').toLowerCase().split(':');
  return { base, slug: rest.join(':') };
}

function lowerHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) out[k.toLowerCase()] = String(v ?? '');
  return out;
}

export interface NormalizedInbound {
  payload: Record<string, unknown>;
  raw: string;
  query: Record<string, string>;
  headers: Record<string, string>;
}

/**
 * ONE shape for every provider: GET query params or a JSON body.
 * Arrays are wrapped as `{ items: [...] }` so every mapper reads an object.
 */
export function normalizeInboundRequest(input: {
  method: string;
  provider?: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}): NormalizedInbound {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.query ?? {})) {
    if (v !== undefined && v !== null) query[k] = String(v);
  }
  const headers = lowerHeaders(input.headers);
  let payload: Record<string, unknown> = {};
  let raw = '';
  if (String(input.method).toUpperCase() === 'GET') {
    if (!input.provider || normalizesQueryToBody(input.provider)) {
      payload = { ...query };
      raw = JSON.stringify(payload);
    }
  } else if (typeof input.body === 'string') {
    raw = input.body;
    try {
      const parsed = JSON.parse(raw);
      payload = parsed && typeof parsed === 'object'
        ? (Array.isArray(parsed) ? { items: parsed } : parsed)
        : { value: parsed };
    } catch {
      // Non-JSON form post (Tally can send urlencoded): keep pairs.
      const params = new URLSearchParams(raw);
      payload = params.size ? Object.fromEntries(params.entries()) : { value: raw };
    }
  } else if (input.body && typeof input.body === 'object') {
    payload = Array.isArray(input.body)
      ? { items: input.body }
      : (input.body as Record<string, unknown>);
    raw = JSON.stringify(input.body);
  }
  return { payload, raw, query, headers };
}

function b64ToBytes(text: string): Uint8Array | null {
  try {
    const raw = atob(text);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function hexToBytes(text: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(text) || text.length % 2) return null;
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmac(algorithm: 'SHA-1' | 'SHA-256', raw: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: algorithm }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  return new Uint8Array(sig);
}

export function signatureHeaders(headers: Record<string, string>): string[] {
  return [
    'x-hub-signature-256', 'x-hub-signature',
    'tally-signature', 'x-tally-signature',
    'x-alibaba-signature', 'x-tradeindia-signature', 'x-justdial-signature',
    'x-zoho-webhook-signature', 'x-ingest-signature', 'x-signature',
  ]
    .map((name) => headers[name])
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/**
 * Verify ANY provider's HMAC over the RAW body. Providers disagree on
 * encoding (`sha256=<hex>` prefix, bare hex, base64) so every candidate is
 * tried and the algorithm is inferred (sha256 default, sha1 for *-sha1).
 */
export async function verifyWebhookSignature(
  raw: string,
  candidates: string[],
  secret: string,
): Promise<boolean> {
  if (!secret) return false;
  if (!candidates.length) return false;
  const digests = await Promise.all([hmac('SHA-256', raw, secret), hmac('SHA-1', raw, secret)]);
  for (const candidate of candidates) {
    const value = candidate.trim();
    const body = value.includes('=') && /^[a-z0-9]+=/i.test(value) ? value.split('=').slice(1).join('=') : value;
    const bytes = hexToBytes(body) ?? b64ToBytes(body);
    if (!bytes) continue;
    if (bytes.length === digests[0].length && equalBytes(bytes, digests[0])) return true;
    if (bytes.length === digests[1].length && equalBytes(bytes, digests[1])) return true;
  }
  return false;
}

/** Every provider's id is fuzzy; check common spellings, case-insensitively. */
export function extractExternalEventId(source: string, payload: Record<string, any>): string | null {
  const { base } = parseSourceKey(source);
  if (base === 'whatsapp') {
    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const id = value?.messages?.[0]?.id ?? value?.statuses?.[0]?.id;
    if (id) return String(id);
  }
  if (base === 'zoho') {
    const id = payload?.estimate_id ?? payload?.estimate?.estimate_id;
    const stamp = payload?.last_modified_time ?? payload?.estimate?.last_modified_time ?? '';
    if (id) return stamp ? `${id}:${stamp}` : String(id);
  }
  if (base === 'tally') {
    const responseId = payload?.data?.responseId ?? payload?.data?.submissionId ?? payload?.data?.response_id;
    if (responseId) return String(responseId);
    const eventId = payload?.eventId ?? payload?.event_id;
    if (eventId) return String(eventId);
  }
  const wanted = new Set([
    'leadid', 'lead_id', 'rfi_id', 'rfiid', 'requestid', 'request_id', 'inquiryid', 'inquiry_id',
    'submissionid', 'submission_id', 'responseid', 'response_id', 'eventid', 'event_id', 'id', 'uuid',
  ]);
  const queue: Array<[string, unknown]> = Object.entries(payload ?? {});
  const normalized: Record<string, unknown> = {};
  for (const [k, v] of queue) normalized[k.toLowerCase()] = v;
  for (const key of wanted) {
    const hit = normalized[key];
    if (hit !== undefined && hit !== null && String(hit).trim()) return String(hit).trim();
  }
  const nested = normalized['data'] ?? normalized['lead'] ?? normalized['enquiry'];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return extractExternalEventId(source, nested as Record<string, any>);
  }
  return null;
}

/** +91XXXXXXXXXX or '' — the ONLY phone form stored on a lead. */
export function normalizeIndianPhone(value: unknown): string {
  let digits = String(value ?? '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.length > 10) digits = digits.slice(-10);
  if (digits.length === 10) return `+91${digits}`;
  return '';
}

export function eventTypeOf(source: string, payload: Record<string, any>): string {
  const { base } = parseSourceKey(source);
  if (base === 'whatsapp') {
    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    return value?.messages ? 'message' : value?.statuses ? 'status' : 'webhook';
  }
  if (base === 'zoho') return payload?.estimate_id || payload?.estimate ? 'estimate.updated' : 'webhook';
  if (base === 'tally') return payload?.eventType || payload?.event_type || 'form.response';
  return 'lead';
}
/**
 * Manifest-driven door check. The ORDER is law: this runs BEFORE any row is
 * staged, so a forged payload never reaches hlp_ingested_data.
 */
export async function verifyInbound(
  provider: string,
  input: {
    raw: string;
    payload: Record<string, any>;
    headers?: Record<string, string>;
    config?: Record<string, unknown>;
    secrets?: Record<string, string>;
  },
): Promise<{ ok: boolean; reason?: string }> {
  const spec = verificationFor(provider);
  if (!spec || spec.kind === 'none') return { ok: true };
  const headers = input.headers || {};
  const cfg = input.config || {};
  const secrets = input.secrets || {};

  if (spec.kind === 'hmac') {
    const secret = String(
      (spec.secretField ? secrets[spec.secretField] : '') ||
        (spec.configField ? cfg[spec.configField] : '') ||
        secrets.webhookSecret || '',
    );
    if (!secret) {
      return spec.optionalIfSecretUnset ? { ok: true } : { ok: false, reason: 'webhook secret is not configured' };
    }
    const headerName = spec.headerNameFromConfig
      ? String(cfg[spec.headerNameFromConfig] || '')
      : (spec.header || 'x-ingest-signature');
    const header = headerValue(headers, headerName);
    // A configured secret means the provider MUST sign: only a missing
    // SECRET is optional, never a missing signature header.
    if (!header) return { ok: false, reason: `missing ${headerName} header` };
    const candidate = spec.prefix && header.startsWith(spec.prefix) ? header.slice(spec.prefix.length) : header;
    const ok = await verifyWebhookSignature(input.raw, [candidate], secret);
    return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' };
  }

  if (spec.kind === 'field_match') {
    const field = spec.field || 'id';
    const expected = String(cfg[spec.configField || ''] ?? '');
    if (!expected && spec.optionalIfConfigUnset) return { ok: true };
    const got = String(getPath(input.payload, field) ?? input.payload[field] ?? '');
    if (expected && got && got !== expected) return { ok: false, reason: `field ${field} does not match the instance` };
    if (expected && !got) return { ok: false, reason: `missing field ${field}` };
    return { ok: true };
  }

  // optional_header_token: when the instance has a token, the header must match;
  // when it does not, the provider's own payload is the only credential.
  const expected = String(
    (spec.secretField ? secrets[spec.secretField] : '') ||
      (spec.configField ? cfg[spec.configField] : '') ||
      secrets.webhookSecret || cfg.verifyToken || '',
  );
  if (!expected) return { ok: true };
  const got = headerValue(headers, spec.header || 'x-webhook-token');
  return got === expected ? { ok: true } : { ok: false, reason: 'webhook token mismatch' };
}

/** ONE idempotency answer, chosen by the manifest (path | composite | config_path). */
export function extractIdempotencyKey(
  provider: string,
  payload: Record<string, any>,
  config: Record<string, unknown> = {},
): string | null {
  const spec = idempotencyFor(provider);
  if (!spec) return extractExternalEventId(provider, payload);

  const read = (path?: string): string => {
    if (!path) return '';
    const value = getPath(payload, path);
    return value !== undefined && value !== null && String(value).trim() ? String(value).trim() : '';
  };
  const candidatePaths = [...(spec.paths || []), spec.path].filter((p): p is string => !!p);
  if (spec.mode !== 'composite') {
    for (const path of candidatePaths) {
      const value = read(path);
      if (value) return value;
    }
  }
  if (spec.mode === 'config_path') {
    const field = String(config[spec.configField || 'idempotencyField'] || '');
    const value = read(field);
    if (value) return value;
  }
  const parts = spec.mode === 'composite' ? (spec.parts || spec.paths || []) : (spec.parts || []);
  const values = parts
    .map((part) => {
      const direct = read(part);
      if (direct) return direct;
      for (const prefix of spec.prefixes || []) {
        const nested = read(`${prefix}${part}`);
        if (nested) return nested;
      }
      return '';
    })
    .filter(Boolean);
  if (values.length) return values.join(':');
  for (const path of spec.fallbacks || []) {
    const value = read(path);
    if (value) return value;
  }
  return extractExternalEventId(provider, payload);
}

/** Manifest flag: GET query params are the payload for this provider. */
export function normalizesQueryToBody(provider: string): boolean {
  return !!getProviderManifest(provider)?.inbound.normalizeQueryToBodyOnGet;
}
