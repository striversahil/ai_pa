// mapping.ts — the ONE payload → event mapping DSL (pure; dual-runtime).
//
// A portal payload is DATA, never code: the panel edits JSON paths, so adding
// a service in the future never means shipping an adapter. Built-in adapters
// (Tally) normalize their own shape; everything else — IndiaMART, TradeIndia,
// a custom CRM — is a MappingSpec stored on the connector or the source.
//
// Paths accept dot + optional index syntax: `data.fields`, `leads[0].NAME`.

export type MappingTarget =
  | 'externalId' | 'occurredAt' | 'kind' | 'title' | 'summary'
  | 'company' | 'contactName' | 'phone' | 'email' | 'city' | 'amount';

export type DateFormat = 'iso' | 'epoch_s' | 'epoch_ms' | 'dd-mm-yyyy' | 'yyyy-mm-dd';

export interface MappingSpec {
  /** Array of records inside the payload; empty = one event per payload. */
  itemsPath?: string;
  /** Canonical field → JSON path in each item. */
  fields?: Partial<Record<MappingTarget, string>>;
  /** Fixed values (e.g. kind: "lead") — always win over `fields`. */
  literals?: Partial<Record<MappingTarget, string>>;
  occurredAtFormat?: DateFormat;
  /** Defaults to `lead` for mapped services, `raw` for the generic hook. */
  eventKind?: string;
}

export interface DraftEvent {
  externalId: string;
  kind: string;
  occurredAt: string;
  title: string;
  summary: string;
  company: string;
  contactName: string;
  phone: string;
  email: string;
  city: string;
  amount: number | null;
  payload: Record<string, unknown>;
}

export interface MappingResult { events: DraftEvent[]; warnings: string[] }

/** Split `a.b[2].c` into segments without regex (Worker + Node identical). */
export function pathSegments(path: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch === '.') { if (buf) out.push(buf); buf = ''; continue; }
    if (ch === '[') {
      if (buf) out.push(buf);
      buf = '';
      const end = path.indexOf(']', i);
      if (end < 0) { out.push(path.slice(i + 1)); return out; }
      out.push(path.slice(i + 1, end));
      i = end;
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

export function getPath(input: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: any = input;
  for (const seg of pathSegments(path)) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Deterministic id for payloads the service does not identify (FNV-1a 32). */
export function stableId(value: unknown): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 'h' + h.toString(16).padStart(8, '0') + '-' + s.length.toString(36);
}

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return str(o.text ?? o.label ?? o.name ?? o.value ?? '');
  }
  return '';
}

export function normalizePhone(v: unknown): string {
  const raw = str(v);
  let out = '';
  for (const ch of raw) if ((ch >= '0' && ch <= '9') || ch === '+') out += ch;
  return out.slice(0, 20);
}

/** IST-friendly ISO timestamp; anything unparseable becomes now. */
export function normalizeDate(v: unknown, fmt: DateFormat = 'iso', now = new Date()): string {
  const raw = str(v);
  if (!raw) return now.toISOString();
  if (fmt === 'epoch_s' || fmt === 'epoch_ms') {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return new Date(fmt === 'epoch_s' ? n * 1000 : n).toISOString();
    return now.toISOString();
  }
  if (fmt === 'dd-mm-yyyy') {
    const p = raw.split(/[\/\-.]/);
    if (p.length === 3) {
      const d = new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]), 12);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return now.toISOString();
  }
  const d = new Date(fmt === 'yyyy-mm-dd' ? raw + (raw.length === 10 ? 'T12:00:00+05:30' : '') : raw);
  return Number.isNaN(d.getTime()) ? now.toISOString() : d.toISOString();
}

function pick(item: unknown, target: MappingTarget, spec: MappingSpec): unknown {
  const literal = spec.literals?.[target];
  if (literal != null && literal !== '') return literal;
  const path = spec.fields?.[target];
  return path ? getPath(item, path) : undefined;
}

/** Payload → 0..N draft events. Never throws; every gap is a warning. */
export function applyMapping(payload: unknown, spec: MappingSpec, now = new Date()): MappingResult {
  const warnings: string[] = [];
  const itemsRaw = spec.itemsPath ? getPath(payload, spec.itemsPath) : payload;
  const items = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];
  if (spec.itemsPath && !Array.isArray(itemsRaw)) warnings.push(`itemsPath "${spec.itemsPath}" is not an array`);
  if (!items.length) warnings.push('no items found in the payload');
  const events: DraftEvent[] = [];
  for (const item of items.slice(0, 200)) {
    if (item == null) continue;
    const externalId = str(pick(item, 'externalId', spec)) || stableId(item);
    const company = str(pick(item, 'company', spec)).slice(0, 200);
    const contactName = str(pick(item, 'contactName', spec)).slice(0, 200);
    const phone = normalizePhone(pick(item, 'phone', spec));
    const email = str(pick(item, 'email', spec)).toLowerCase().slice(0, 200);
    const city = str(pick(item, 'city', spec)).slice(0, 120);
    const title = (str(pick(item, 'title', spec)) || company || contactName || phone || email || 'New activity').slice(0, 200);
    const summary = str(pick(item, 'summary', spec)).slice(0, 4000);
    const kind = str(pick(item, 'kind', spec)) || spec.eventKind || 'raw';
    const occurredAt = normalizeDate(pick(item, 'occurredAt', spec), spec.occurredAtFormat ?? 'iso', now);
    const amountRaw = pick(item, 'amount', spec);
    const amountNum = typeof amountRaw === 'number' ? amountRaw : Number(str(amountRaw).replace(/[^0-9.\-]/g, ''));
    const amount = Number.isFinite(amountNum) && String(amountRaw ?? '').trim() !== '' ? amountNum : null;
    events.push({ externalId, kind, occurredAt, title, summary, company, contactName, phone, email, city, amount, payload: item as Record<string, unknown> });
  }
  if (!spec.fields?.externalId) warnings.push('externalId is not mapped — duplicates fall back to a payload hash');
  if (!Object.keys(spec.fields ?? {}).length) warnings.push('no fields mapped — the event will only carry the raw payload');
  return { events, warnings };
}

/** Persisted JSON → spec (tolerates junk: never throws). */
export function parseMapping(raw: string | null | undefined): MappingSpec {
  if (!raw) return { fields: {} };
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return { fields: {} };
    return {
      itemsPath: typeof v.itemsPath === 'string' ? v.itemsPath : undefined,
      fields: v.fields && typeof v.fields === 'object' ? v.fields : {},
      literals: v.literals && typeof v.literals === 'object' ? v.literals : undefined,
      occurredAtFormat: v.occurredAtFormat,
      eventKind: typeof v.eventKind === 'string' ? v.eventKind : undefined,
    };
  } catch { return { fields: {} }; }
}
