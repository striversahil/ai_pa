// similarity.ts — price-memory helpers (edge-safe: fetch only, no Node deps).
//
// Price memory = finalized enquiry items stored as Pinecone vectors (384-dim,
// HF all-MiniLM-L6-v2 — same model as BrainEmbedder). One serverless index,
// namespace per KYP category (+ `uncategorized` for legacy backfill rows).
// Only technical spec text is embedded — never client PII.
export const PRICE_MEMORY_DIM = 384;
export const PRICE_MEMORY_INDEX = 'enquiry-items';
export const UNCATEGORIZED_NS = 'uncategorized';

export const EXACT_THRESHOLD = 0.97;
export const SUGGEST_THRESHOLD = 0.85;

const HF_ROUTER_URL =
  'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction';

export interface PricedItem {
  enquiryId: string;
  itemIndex: number;
  category?: string;
  name: string;
  qty: string;
  spec: string;
  vendorRate?: number;
  finalRate?: number;
  markup?: number;
  finalizedAt?: string;
}

/** Technical spec text only: name + qty + spec. No client PII, no vendors. */
export function buildItemSpecText(it: Pick<PricedItem, 'name' | 'qty' | 'spec'>): string {
  return [String(it.name ?? ''), String(it.qty ?? ''), String(it.spec ?? '')]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' | ')
    .slice(0, 1000);
}

/** Light canonicalization for exact-match: lowercase, unify inch/mm words,
 *  collapse whitespace. Numeric values are NOT converted (25.4mm != 1in here —
 *  that stays a near-match, never a silent auto-quote). */
export function canonicalSpec(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/["″]/g, ' in ')
    .replace(/\binch\b|\binches\b/g, ' in ')
    .replace(/\bmm\b/g, ' mm ')
    .replace(/\bcm\b/g, ' cm ')
    .replace(/[,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function dimsEqual(a: string, b: string): boolean {
  const ca = canonicalSpec(a);
  const cb = canonicalSpec(b);
  return ca.length > 0 && ca === cb;
}

export type RouteDecision = 'exact' | 'suggest' | 'miss';

export function routeByScore(score: number, exact: boolean): RouteDecision {
  if (exact && score >= EXACT_THRESHOLD) return 'exact';
  if (score >= SUGGEST_THRESHOLD) return 'suggest';
  return 'miss';
}

/** Pinecone namespace for a category (lowercase, spaces -> dashes). */
export function namespaceFor(category?: string): string {
  const c = String(category ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return c || UNCATEGORIZED_NS;
}

/** Embed texts via HF router. Returns null on any failure (caller skips). */
export async function embedTexts(env: Record<string, unknown>, texts: string[]): Promise<number[][] | null> {
  const key = String((env as any)?.HF_API_KEY ?? '').trim();
  if (!key || texts.length === 0) return null;
  try {
    const res = await fetch(HF_ROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: texts }),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (Array.isArray(data) && data.length > 0 && Array.isArray((data as unknown[])[0])) {
      return data as number[][];
    }
    if (Array.isArray(data) && typeof (data as unknown[])[0] === 'number') return [data as number[]];
    return null;
  } catch {
    return null;
  }
}

function pineconeBase(env: Record<string, unknown>): { host: string; key: string } | null {
  const host = String((env as any)?.PINECONE_HOST ?? '').trim().replace(/\/+$/, '');
  const key = String((env as any)?.PINECONE_API_KEY ?? '').trim();
  if (!host || !key) return null;
  return { host, key };
}

export interface PineconeMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/** Query top-K vectors in a namespace. Null = unconfigured/failed (caller treats as miss). */
export async function pineconeQuery(
  env: Record<string, unknown>,
  namespace: string,
  vector: number[],
  topK = 5,
): Promise<PineconeMatch[] | null> {
  const base = pineconeBase(env);
  if (!base) return null;
  try {
    const res = await fetch(`${base.host}/query`, {
      method: 'POST',
      headers: { 'Api-Key': base.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace, vector, topK, includeMetadata: true }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { matches?: PineconeMatch[] };
    return Array.isArray(data.matches) ? data.matches : [];
  } catch {
    return null;
  }
}

/** Upsert vectors: [{ id, values, metadata }]. Returns upserted count or -1 on skip/fail. */
export async function pineconeUpsert(
  env: Record<string, unknown>,
  namespace: string,
  vectors: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }>,
): Promise<number> {
  const base = pineconeBase(env);
  if (!base || vectors.length === 0) return -1;
  try {
    const res = await fetch(`${base.host}/vectors/upsert`, {
      method: 'POST',
      headers: { 'Api-Key': base.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace, vectors }),
    });
    if (!res.ok) return -1;
    return vectors.length;
  } catch {
    return -1;
  }
}

/** Vector id for a priced item: stable across backfill re-runs (idempotent). */
export function memoryVectorId(enquiryId: string, itemIndex: number): string {
  return `enq:${enquiryId}:item:${itemIndex}`;
}
