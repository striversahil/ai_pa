// service.ts — the ingestion pipeline: catalog, connections, verification,
// normalization and replay. Routes stay thin (parse → this → JSON).

import * as store from './store';
import { applyMapping, parseMapping, type DraftEvent, type MappingSpec } from './mapping';
import { BUILTIN_CONNECTORS, addableConnectors, builtinConnector } from './catalog';
import { normalizeTally } from './adapters/tally';
import type { CatalogEntry, ConnectorRow, EventRow, SourceRow, SourceView } from './types';

type Db = D1Database;
type Kv = { get(k: string): Promise<string | null>; put(k: string, v: string): Promise<void>; delete(k: string): Promise<void> } | null | undefined;

const SECRET_PREFIX = 'integration:secret:';
const MAX_EVENTS_PER_CALL = 50;

export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function putSecret(kv: Kv, sourceId: string, key: string, value: string): Promise<void> {
  await kv?.put(`${SECRET_PREFIX}${sourceId}:${key}`, value);
}

export async function getSecret(kv: Kv, sourceId: string, key: string): Promise<string> {
  return (await kv?.get(`${SECRET_PREFIX}${sourceId}:${key}`)) || '';
}

export async function deleteSecrets(kv: Kv, sourceId: string, keys: string[]): Promise<void> {
  for (const key of keys) await kv?.delete(`${SECRET_PREFIX}${sourceId}:${key}`);
}

/** Which secret fields a source has set (never the values). */
export async function secretFlags(kv: Kv, sourceId: string, keys: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const key of keys) out[key] = !!(await getSecret(kv, sourceId, key));
  return out;
}

// ── Catalog ────────────────────────────────────────────────────────────────

function customEntry(row: ConnectorRow): CatalogEntry {
  return {
    key: row.key, name: row.name, icon: row.icon || '🔌', color: row.color,
    category: row.category || 'Custom', authKind: 'webhook', status: 'live',
    mapping: parseMapping(row.mapping), customId: row.id,
    hint: 'Custom service — mapping is editable in the panel.',
  };
}

export async function buildCatalog(db: Db): Promise<CatalogEntry[]> {
  const rows = await store.listConnectors(db);
  return [...addableConnectors(), ...rows.filter((r) => r.status !== 'archived').map(customEntry)];
}

export async function entryForSource(db: Db, source: SourceRow): Promise<CatalogEntry> {
  const builtin = builtinConnector(source.connectorKey);
  if (builtin) return builtin;
  const row = await store.getConnector(db, source.connectorKey);
  if (row) return customEntry(row);
  return { key: source.connectorKey, name: source.name, icon: '🔌', category: 'Custom', authKind: 'webhook', status: 'live', mapping: { fields: {} } };
}

export async function entryForConnector(db: Db, connectorKey: string): Promise<CatalogEntry | null> {
  const builtin = builtinConnector(connectorKey);
  if (builtin) return builtin;
  const row = await store.getConnector(db, connectorKey);
  return row ? customEntry(row) : null;
}

// ── Connections ────────────────────────────────────────────────────────────

export interface CreateSourceInput {
  connectorKey?: string;
  connectorId?: string;
  newConnector?: { name?: string; icon?: string; color?: string; mapping?: MappingSpec; sample?: string };
  name?: string;
  config?: Record<string, unknown>;
  mapping?: MappingSpec;
}

export interface CreatedSource { source: SourceView; token: string; signingSecret: string }

/** Create a connection. The token + signing secret are returned ONCE. */
export async function createSource(db: Db, kv: Kv, input: CreateSourceInput, actor: { id: string; name: string }): Promise<CreatedSource> {
  let connectorKey = String(input.connectorKey ?? '').trim();
  if (!connectorKey && input.connectorId) {
    const custom = await store.getConnector(db, String(input.connectorId));
    if (!custom) throw Object.assign(new Error('Unknown connector'), { status: 404 });
    connectorKey = custom.key;
  }
  if (!connectorKey && input.newConnector) {
    const created = await createConnector(db, input.newConnector, actor);
    connectorKey = created.key;
  }
  if (!connectorKey) connectorKey = 'generic';
  const entry = await entryForConnector(db, connectorKey);
  if (!entry) throw Object.assign(new Error('Unknown service'), { status: 400 });
  if (entry.native) throw Object.assign(new Error(`${entry.name} is ingested by its own pipeline`), { status: 400 });

  const id = crypto.randomUUID();
  const token = randomHex(24);
  const signingSecret = randomHex(24);
  const at = store.nowIso();
  const config: Record<string, unknown> = { ...(input.config ?? {}) };
  const secrets = ['apiKey', 'pageAccessToken', 'verifyToken'];
  for (const key of secrets) {
    const value = String((input.config as any)?.[key] ?? '').trim();
    delete config[key];
    if (value) await putSecret(kv, id, key, value);
  }
  const row: SourceRow = {
    id, connectorKey, name: String(input.name ?? '').trim() || entry.name, status: 'active',
    tokenHash: await sha256Hex(token), config: JSON.stringify(config),
    mapping: input.mapping ? JSON.stringify(input.mapping) : '',
    eventCount: 0, lastEventAt: '', lastError: '',
    createdBy: actor.id, createdByName: actor.name, createdAt: at, updatedAt: at,
  };
  await store.insertSource(db, row);
  await putSecret(kv, id, 'hmac', signingSecret);
  // The URL itself is a credential: D1 keeps only the hash, KV keeps the token
  // so the panel can show/copy the webhook URL again (email does the same).
  await putSecret(kv, id, 'token', token);
  return { source: view(row, entry, token, signingSecret), token, signingSecret };
}

export function view(source: SourceRow, connector: CatalogEntry, token?: string, signingSecret?: string): SourceView {
  return { ...source, connector, token, webhookUrl: token ? webhookPath(source.id, token) : undefined, signingSecret };
}

export function webhookPath(sourceId: string, token: string): string {
  return `/api/ingest/${sourceId}/${token}`;
}

export async function rotateSource(db: Db, kv: Kv, source: SourceRow): Promise<string> {
  const token = randomHex(24);
  await store.setSourceToken(db, source.id, await sha256Hex(token));
  await putSecret(kv, source.id, 'token', token);
  return token;
}

export async function createConnector(db: Db, input: { name?: string; icon?: string; color?: string; mapping?: MappingSpec; sample?: string }, actor: { id: string; name: string }): Promise<ConnectorRow> {
  const name = String(input.name ?? '').trim();
  if (!name) throw Object.assign(new Error('Name is required'), { status: 400 });
  const at = store.nowIso();
  const row: ConnectorRow = {
    id: crypto.randomUUID(), key: `c-${randomHex(4)}`, name: name.slice(0, 80),
    icon: String(input.icon ?? '🔌').slice(0, 8) || '🔌', color: String(input.color ?? ''),
    category: 'Custom', authKind: 'webhook', mapping: JSON.stringify(input.mapping ?? { fields: {} }),
    sample: String(input.sample ?? '').slice(0, 20000), status: 'active',
    createdBy: actor.id, createdByName: actor.name, createdAt: at, updatedAt: at,
  };
  await store.insertConnector(db, row);
  return row;
}

export async function connectorViews(db: Db): Promise<ConnectorRow[]> {
  return store.listConnectors(db);
}

export { BUILTIN_CONNECTORS };
// ── Signature ──────────────────────────────────────────────────────────────

function base64Bytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.trim());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

/** Tally-Signature / X-Ingest-Signature = HMAC-SHA256 of the RAW body (base64). */
export async function verifyHmac(raw: string, signature: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify', 'sign']);
  const sig = signature.trim();
  const bytes = base64Bytes(sig);
  if (bytes) return crypto.subtle.verify('HMAC', key, bytes, enc.encode(raw));
  // Some portals send hex instead of base64 — accept both.
  if (/^[0-9a-fA-F]{64}$/.test(sig)) {
    const digest = await crypto.subtle.sign('HMAC', key, enc.encode(raw));
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    return equal(hex, sig.toLowerCase());
  }
  return false;
}

// ── Preview ────────────────────────────────────────────────────────────────

export function previewEvents(payload: unknown, connectorKey: string, spec: MappingSpec) {
  if (connectorKey === 'tally') return normalizeTally(payload);
  return applyMapping(payload, spec);
}

// ── Ingest ─────────────────────────────────────────────────────────────────

export interface IngestOutcome { status: number; body: Record<string, unknown> }

function safeJson(raw: string): Record<string, unknown> {
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

function draftToRow(source: SourceRow, connectorKey: string, d: DraftEvent, raw: string): EventRow {
  const at = store.nowIso();
  return {
    id: crypto.randomUUID(), sourceId: source.id, connectorKey, externalId: d.externalId.slice(0, 200),
    kind: d.kind.slice(0, 40), occurredAt: d.occurredAt, title: d.title, summary: d.summary,
    company: d.company, contactName: d.contactName, phone: d.phone, email: d.email, city: d.city,
    amount: d.amount, payload: JSON.stringify(d.payload).slice(0, 20000), raw: raw.slice(0, 20000),
    linkedType: '', linkedId: '', status: 'accepted', error: '', createdAt: at,
  };
}

async function recordDelivery(db: Db, sourceId: string, raw: string, status: string, httpStatus: number, error: string, eventId: string): Promise<string> {
  const id = crypto.randomUUID();
  await store.insertDelivery(db, {
    id, sourceId, receivedAt: store.nowIso(), status, httpStatus, error,
    bodyPreview: raw.slice(0, 2000), bytes: raw.length, eventId,
  });
  return id;
}

export interface IngestInput {
  db: Db;
  kv: Kv;
  source: SourceRow;
  connector: CatalogEntry;
  token: string;
  raw: string;
  headers: Record<string, string>;
}

/** Verify + normalize + store one webhook call. Always records a delivery. */
export async function ingest(input: IngestInput): Promise<IngestOutcome> {
  const { db, kv, source, connector, token, raw, headers } = input;
  const tokenOk = equal(await sha256Hex(token), String(source.tokenHash ?? ''));
  if (!tokenOk) {
    await recordDelivery(db, source.id, raw, 'rejected', 404, 'unknown token', '').catch(() => '');
    return { status: 404, body: { ok: false, error: 'Not found' } };
  }
  if (source.status === 'paused') {
    await recordDelivery(db, source.id, raw, 'paused', 202, '', '').catch(() => '');
    return { status: 202, body: { ok: true, paused: true } };
  }
  const config = safeJson(source.config);
  const secret = await getSecret(kv, source.id, 'hmac');
  if (secret && config.requireSignature !== false) {
    const signature = headers['tally-signature'] || headers['x-ingest-signature'] || '';
    if (!signature || !(await verifyHmac(raw, signature, secret))) {
      await recordDelivery(db, source.id, raw, 'rejected', 401, 'invalid signature', '').catch(() => '');
      return { status: 401, body: { ok: false, error: 'Invalid signature' } };
    }
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch {
    await recordDelivery(db, source.id, raw, 'error', 400, 'invalid JSON', '').catch(() => '');
    return { status: 400, body: { ok: false, error: 'Invalid JSON' } };
  }
  try {
    const spec = source.mapping ? parseMapping(source.mapping) : connector.mapping;
    const result = previewEvents(payload, connector.key, spec);
    if (!result.events.length) {
      await recordDelivery(db, source.id, raw, 'error', 422, result.warnings[0] ?? 'nothing to ingest', '');
      return { status: 422, body: { ok: false, error: result.warnings[0] ?? 'Nothing to ingest', warnings: result.warnings } };
    }
    let firstId = '';
    let duplicates = 0;
    for (const draft of result.events.slice(0, MAX_EVENTS_PER_CALL)) {
      const row = draftToRow(source, connector.key, draft, raw);
      const inserted = await store.insertEvent(db, row);
      if (!inserted) { duplicates++; continue; }
      if (!firstId) firstId = row.id;
      await store.bumpSourceStats(db, source.id, row.occurredAt);
    }
    await recordDelivery(db, source.id, raw, 'accepted', 202, '', firstId);
    return {
      status: 202,
      body: { ok: true, eventId: firstId || undefined, duplicates, events: result.events.length, warnings: result.warnings },
    };
  } catch (e: any) {
    const message = String(e?.message ?? 'ingest failed').slice(0, 300);
    await recordDelivery(db, source.id, raw, 'error', 500, message, '').catch(() => '');
    await store.patchSource(db, source.id, { lastError: message }).catch(() => {});
    return { status: 500, body: { ok: false, error: message } };
  }
}

// ── Replay ─────────────────────────────────────────────────────────────────

export interface ReplayResult { ok: boolean; event?: EventRow; error?: string }

/** Re-normalize a stored event's raw body with the CURRENT mapping. */
export async function replayEvent(db: Db, source: SourceRow, connector: CatalogEntry, event: EventRow): Promise<ReplayResult> {
  const raw = String(event.raw ?? '');
  if (!raw) return { ok: false, error: 'no raw payload stored' };
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return { ok: false, error: 'stored payload is not JSON' }; }
  const spec = source.mapping ? parseMapping(source.mapping) : connector.mapping;
  const result = previewEvents(payload, connector.key, spec);
  if (!result.events.length) return { ok: false, error: result.warnings[0] ?? 'nothing to map' };
  const draft = result.events[0];
  const next = draftToRow(source, connector.key, draft, raw);
  const updated = await store.updateEvent(db, event.id, {
    externalId: draft.externalId, kind: draft.kind, occurredAt: draft.occurredAt,
    title: draft.title, summary: draft.summary, company: draft.company,
    contactName: draft.contactName, phone: draft.phone, email: draft.email,
    city: draft.city, amount: draft.amount, payload: next.payload,
  });
  return { ok: true, event: updated };
}