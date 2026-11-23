// catalog-live.ts — the KYP catalogue as it currently exists in D1.
//
// Founder decision 2026-11-23: the dashboard OWNS the catalogue (products,
// aliases, categories, spec type/enum/required/order) and everything that
// typechecks a quote or exports the KYP JSON reads THIS, not the compiled seed.
// The compiled `kyp-catalog.ts` remains the import snapshot for a fresh DB.
//
// Cached in KV (`product-line:catalog:v1`, 10 min) and invalidated by every
// product/guide/category write (`update.ts#touched`).
import { cached, cacheDel } from '../../shared/cache';
import { readDeclaredCategories } from './catalog-categories';
import { parseStoredDefault } from './spec-default';
import { getD1Database } from '../../shared/prisma-d1';
import type { KypProduct, KypSpecProp, KypSpecRule } from './kyp-catalog';

export const LIVE_CATALOG_KEY = 'product-line:catalog:v1';
const TTL_MS = 10 * 60 * 1000;

interface GuideRow {
  productId: string;
  attrKey: string;
  question: string;
  isRequired: unknown;
  sortOrder: unknown;
  condition: string | null;
  type: string | null;
  enumJson: string | null;
  minNum: number | null;
  maxNum: number | null;
  defaultValue: string | null;
  active: unknown;
}

interface ProductRow {
  id: string;
  key: string | null;
  category: string;
  name: string;
  aliases: string | null;
  active: unknown;
}

export interface LiveProduct extends KypProduct {
  id: string;
  active: boolean;
}

/** Everything the UI + validator need: one entry per product, specs ordered. */
export interface LiveCatalog {
  categories: string[];
  products: LiveProduct[];
}

function parseAliases(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  } catch {
    return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  }
}

function parseEnum(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    const list = Array.isArray(v) ? v.map(String).filter(Boolean) : [];
    return list.length ? list : undefined;
  } catch {
    const list = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    return list.length ? list : undefined;
  }
}

function parseRules(raw: string | null): KypSpecRule[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter((r) => r && typeof r === 'object' && r.whenKey && r.key)
      .map((r: any) => ({
        whenKey: String(r.whenKey),
        whenValue: String(r.whenValue ?? ''),
        key: String(r.key),
        ...(typeof r.min === 'number' ? { min: r.min } : {}),
        ...(typeof r.max === 'number' ? { max: r.max } : {}),
      }));
  } catch {
    return [];
  }
}

/** Key for a product row: explicit `key`, else the `pi_<key>` seed id, else a slug of the name. */
export function keyOf(row: { id?: unknown; key?: unknown; name?: unknown }): string {
  const explicit = String(row?.key ?? '').trim();
  if (explicit) return explicit;
  const id = String(row?.id ?? '');
  if (id.startsWith('pi_')) return id.slice(3);
  return String(row?.name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'product';
}

async function load(): Promise<LiveCatalog> {
  const db = getD1Database();
  const [prodRes, guideRes] = await db.batch([
    db.prepare(
      'SELECT id, key, category, name, aliases, active FROM ProductItem ORDER BY category, name',
    ),
    db.prepare(
      'SELECT productId, attrKey, question, isRequired, sortOrder, condition, type, enumJson, minNum, maxNum, ' +
        'defaultValue, active FROM KypGuide ORDER BY productId, sortOrder',
    ),
  ]);
  const products = ((prodRes as any)?.results ?? []) as ProductRow[];
  const guides = ((guideRes as any)?.results ?? []) as GuideRow[];

  const byProduct = new Map<string, GuideRow[]>();
  for (const g of guides) {
    if (g.active === 0 || g.active === false) continue;
    const list = byProduct.get(String(g.productId)) ?? [];
    list.push(g);
    byProduct.set(String(g.productId), list);
  }

  const out: LiveProduct[] = products
    .filter((p) => p.active !== 0 && p.active !== false)
    .map((p) => {
      const rows = (byProduct.get(String(p.id)) ?? []).sort(
        (a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0),
      );
      const props: Record<string, KypSpecProp> = {};
      const required: string[] = [];
      const rules: KypSpecRule[] = [];
      for (const g of rows) {
        const attrKey = String(g.attrKey);
        const type = (String(g.type ?? 'string') || 'string') as KypSpecProp['type'];
        const enumList = parseEnum(g.enumJson);
        const prop: KypSpecProp = { type, label: String(g.question ?? attrKey) };
        if (enumList) prop.enum = enumList;
        if (typeof g.minNum === 'number') prop.min = g.minNum;
        if (typeof g.maxNum === 'number') prop.max = g.maxNum;
        const dflt = parseStoredDefault(g.defaultValue);
        if (dflt !== undefined) prop.default = dflt;
        props[attrKey] = prop;
        if (g.isRequired === 1 || g.isRequired === true) required.push(attrKey);
        rules.push(...parseRules(g.condition));
      }
      return {
        id: String(p.id),
        key: keyOf(p),
        label: String(p.name),
        category: String(p.category),
        categories: [String(p.category)],
        aliases: parseAliases(p.aliases),
        ask: [],
        props,
        required,
        rules,
        active: true,
      };
    });

  // Categories are DERIVED from products plus any the dashboard declared
  // before a product used them (founder decision 2026-11-23: you can add a
  // category first, then file products under it).
  const declared = await readDeclaredCategories().catch(() => []);
  const categories = [...new Set([...declared, ...out.map((p) => p.category)])].sort();
  return { categories, products: out };
}

export async function getLiveCatalog(): Promise<LiveCatalog> {
  return cached(LIVE_CATALOG_KEY, TTL_MS, load);
}

export async function invalidateLiveCatalog(): Promise<void> {
  await cacheDel(LIVE_CATALOG_KEY).catch(() => {});
}

/** Product lookup by row id, schema key or label (case-insensitive). */
export function findLiveProduct(catalog: LiveCatalog, ref: { id?: unknown; key?: unknown; name?: unknown }): LiveProduct | null {
  const id = String(ref?.id ?? '');
  const key = String(ref?.key ?? '');
  const name = String(ref?.name ?? '').toLowerCase();
  for (const p of catalog.products) {
    if (id && p.id === id) return p;
    if (key && p.key === key) return p;
    if (name && p.label.toLowerCase() === name) return p;
  }
  return null;
}
