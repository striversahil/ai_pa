/**
 * gen-kyp-catalog.mjs — compile the founder-authored KYP schema (v2) into the
 * two artifacts the system runs on:
 *
 *   1. src/automations/product-line/kyp-catalog.ts   (runtime catalog + typed specs)
 *   2. migrations/0156_kyp_catalog_v2_seed.sql       (103 products + N spec-ask rows)
 *
 * The JSON in resources/json/kyp/ is the SOLE TRUTH. Never hand-edit either
 * output: re-run `node scripts/gen-kyp-catalog.mjs` (guard: kyp-schema-parity).
 *
 *   node scripts/gen-kyp-catalog.mjs           write both artifacts
 *   node scripts/gen-kyp-catalog.mjs --check   exit 1 if either is stale
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, '..');
const SCHEMA = join(backend, '..', 'resources', 'json', 'kyp', 'bui_milling_vendor_kyp_schema_v2.json');
const CATALOG_TS = join(backend, 'src', 'automations', 'product-line', 'kyp-catalog.ts');
const SEED_SQL = join(backend, 'migrations', '0156_kyp_catalog_v2_seed.sql');

/** Category for a product whose schema branch allows several (founder call
 *  2026-11-23: `transmission_belt` seeds under conveying_accessories). */
const DEFAULT_CATEGORY = { transmission_belt: 'conveying_accessories' };

/** Human label from a machine key. MIRROR: src/automations/product-line/
 *  kyp-schema.ts#labelForSpec (guard kyp-schema-parity checks both agree). */
const ACRONYMS = {
  id: 'ID', od: 'OD', ss: 'SS', ms: 'MS', gi: 'GI', ci: 'CI', pp: 'PP', pu: 'PU', pvc: 'PVC',
  ptfe: 'PTFE', hdpe: 'HDPE', moq: 'MOQ', v: 'V', spc: 'SPC', spb: 'SPB', spz: 'SPZ', spx: 'SPX',
  pcd: 'PCD', tlb: 'TLB', hp: 'HP', kw: 'KW', rpm: 'RPM', um: 'µm', kg: 'kg', mm: 'mm',
  cm: 'cm', m: 'm', ft: 'ft', inch: 'inch', pcs: 'pcs',
};
/** Trailing unit tokens render as a suffix: `width_mm` → "Width (mm)". */
const UNITS = new Set(['mm', 'cm', 'm', 'km', 'kg', 'g', 'mg', 'um', 'ml', 'l', 'inch', 'ft', 'pcs',
  'hp', 'kw', 'rpm', 'pct', 'hz', 'mpa', 'bar', 'mm2', 'm2']);

export function labelForSpec(key) {
  const words = String(key).toLowerCase().replace(/_/g, ' ').trim().split(/\s+/).filter(Boolean);
  let suffix = '';
  const last = words[words.length - 1];
  if (words.length > 1 && (UNITS.has(last) || ACRONYMS[last] && UNITS.has(last))) {
    suffix = ` (${ACRONYMS[last] ?? last})`;
    words.pop();
  }
  const out = words.map((w) => {
    if (ACRONYMS[w]) return ACRONYMS[w];
    if (/^\d+$/.test(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  });
  return out.join(' ') + suffix;
}

function typeOf(prop) {
  const t = [].concat(prop.type ?? 'string');
  if (t.includes('boolean')) return 'boolean';
  if (t.includes('array')) return 'array';
  if (t.includes('integer')) return 'integer';
  if (t.includes('number')) return 'number';
  return 'string';
}

/** One def → the compact spec contract the Worker validates against. */
function compileSpecs(def) {
  const props = {};
  for (const [key, p] of Object.entries(def.properties ?? {})) {
    const out = { type: typeOf(p), label: labelForSpec(key) };
    if (p.enum) out.enum = p.enum.map(String);
    if (typeof p.minimum === 'number') out.min = p.minimum;
    if (typeof p.maximum === 'number') out.max = p.maximum;
    if (typeof p.exclusiveMinimum === 'number') out.gt = p.exclusiveMinimum;
    if (typeof p.minLength === 'number') out.minLen = p.minLength;
    // A declared default is the value a quote starts with when the vendor
    // sheet is silent (founder decision 2026-11-23).
    if (p.default !== undefined) out.default = p.default;
    props[key] = out;
  }
  const rules = [];
  for (const rule of def.allOf ?? []) {
    const when = rule.if?.properties ?? {};
    const then = rule.then?.properties ?? {};
    for (const [whenKey, cond] of Object.entries(when)) {
      if (cond?.const === undefined) continue;
      for (const [targetKey, bound] of Object.entries(then)) {
        const r = { whenKey, whenValue: String(cond.const), key: targetKey };
        if (typeof bound.minimum === 'number') r.min = bound.minimum;
        if (typeof bound.maximum === 'number') r.max = bound.maximum;
        if (r.min !== undefined || r.max !== undefined) rules.push(r);
      }
    }
  }
  return { props, required: (def.required ?? []).map(String), rules };
}

function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const CHUNK = 40;

/** Chunked multi-row INSERT; every chunk carries the upsert tail so a
 *  regeneration updates text in place instead of failing on the PK. */
function chunkInsert(prefix, rows, tail) {
  const out = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    out.push(`${prefix}${rows.slice(i, i + CHUNK).join(',\n')}\n${tail};`);
  }
  return out.join('\n\n');
}

const PRODUCT_TAIL =
  'ON CONFLICT(id) DO UPDATE SET key=excluded.key, category=excluded.category, name=excluded.name, ' +
  'aliases=excluded.aliases, active=excluded.active, updatedAt=excluded.updatedAt';
const GUIDE_TAIL =
  'ON CONFLICT(id) DO UPDATE SET productId=excluded.productId, attrKey=excluded.attrKey, ' +
  'question=excluded.question, isRequired=excluded.isRequired, sortOrder=excluded.sortOrder, ' +
  'condition=excluded.condition, type=excluded.type, enumJson=excluded.enumJson, ' +
  'minNum=excluded.minNum, maxNum=excluded.maxNum, defaultValue=excluded.defaultValue, ' +
  'active=excluded.active, updatedAt=excluded.updatedAt';

function build() {
  const schema = JSON.parse(readFileSync(SCHEMA, 'utf8'));
  const products = [];
  for (const branch of schema.allOf ?? []) {
    const key = branch.if?.properties?.product_key?.const;
    if (!key) continue;
    const def = schema.definitions?.[key];
    if (!def) throw new Error(`no definition for ${key}`);
    const cats = [branch.then?.properties?.category?.const, ...(branch.then?.properties?.category?.enum ?? [])].filter(Boolean);
    const category = DEFAULT_CATEGORY[key] ?? cats[0] ?? def['x-category'];
    if (!category) throw new Error(`no category for ${key}`);
    products.push({
      key,
      label: labelForSpec(key),
      category,
      categories: [...new Set(cats.length ? cats : [category])],
      aliases: (branch.then?.properties?.aliases?.default ?? def['x-aliases'] ?? []).map(String),
      ask: (def['x-client-ask'] ?? []).map(String),
      ...compileSpecs(def),
    });
  }
  products.sort((a, b) => a.key.localeCompare(b.key));
  return products;
}

function catalogTs(products) {
  const lines = [];
  lines.push('// kyp-catalog.ts — GENERATED. Do not edit by hand.');
  lines.push('// Source of truth: resources/json/kyp/bui_milling_vendor_kyp_schema_v2.json');
  lines.push('// Regenerate: node scripts/gen-kyp-catalog.mjs (guard: kyp-schema-parity).');
  lines.push('//');
  lines.push('// One row per product (103). `props` is the typechecked spec contract for');
  lines.push('// that product; `rules` are the schema if/then bounds flattened per key.');
  lines.push('');
  lines.push("export type KypSpecType = 'string' | 'number' | 'integer' | 'boolean' | 'array';");
  lines.push('');
  lines.push('export interface KypSpecProp {');
  lines.push('  type: KypSpecType;');
  lines.push('  /** Baked human label (derived from the key by the generator). */');
  lines.push('  label: string;');
  lines.push('  enum?: string[];');
  lines.push('  min?: number;');
  lines.push('  max?: number;');
  lines.push('  gt?: number;');
  lines.push('  minLen?: number;');
  lines.push('  /** Value a new quote starts with (enum member / number / boolean). */');
  lines.push('  default?: string | number | boolean;');
  lines.push('}');
  lines.push('');
  lines.push('/** if `whenKey` === `whenValue` then the target `key` is bounded by min/max. */');
  lines.push('export interface KypSpecRule {');
  lines.push('  whenKey: string;');
  lines.push('  whenValue: string;');
  lines.push('  key: string;');
  lines.push('  min?: number;');
  lines.push('  max?: number;');
  lines.push('}');
  lines.push('');
  lines.push('export interface KypProduct {');
  lines.push('  key: string;');
  lines.push('  label: string;');
  lines.push('  category: string;');
  lines.push('  categories: string[];');
  lines.push('  aliases: string[];');
  lines.push('  ask: string[];');
  lines.push('  props: Record<string, KypSpecProp>;');
  lines.push('  required: string[];');
  lines.push('  rules: KypSpecRule[];');
  lines.push('}');
  lines.push('');
  lines.push(`export const KYP_CATEGORIES = ${JSON.stringify(
    [...new Set(products.map((p) => p.category))].sort(),
  )} as const;`);
  lines.push('');
  lines.push('export const KYP_PRODUCTS: KypProduct[] = [');
  for (const p of products) lines.push(`  ${JSON.stringify(p)},`);
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}

function seedSql(products) {
  const prodRows = [];
  const guideRows = [];
  for (const p of products) {
    const pid = `pi_${p.key}`;
    prodRows.push(
      `(${sqlStr(pid)}, ${sqlStr(p.key)}, ${sqlStr(p.category)}, ${sqlStr(p.label)}, ${sqlStr(JSON.stringify(p.aliases))}, 1, ${NOW}, ${NOW})`,
    );
    Object.keys(p.props).forEach((attrKey, i) => {
      const rules = p.rules.filter((r) => r.key === attrKey);
      const prop = p.props[attrKey];
      const typed =
        `${sqlStr(prop.type)}, ` +
        `${prop.enum ? sqlStr(JSON.stringify(prop.enum)) : 'NULL'}, ` +
        `${prop.min ?? 'NULL'}, ${prop.max ?? 'NULL'}, ` +
        `${prop.default !== undefined ? sqlStr(JSON.stringify(prop.default)) : 'NULL'}`;
      guideRows.push(
        `(${sqlStr(`kg_${p.key}_${attrKey}`)}, ${sqlStr(pid)}, ${sqlStr(attrKey)}, ${sqlStr(
          prop.label ?? attrKey,
        )}, ${p.required.includes(attrKey) ? 1 : 0}, ${i}, ${rules.length ? sqlStr(JSON.stringify(rules)) : 'NULL'}, ` +
          `${typed}, 1, ${NOW}, ${NOW})`,
      );
    });
  }
  const out = [];
  out.push('-- 0156_kyp_catalog_v2_seed.sql — GENERATED. Do not edit by hand.');
  out.push('--');
  out.push('-- Source of truth: resources/json/kyp/bui_milling_vendor_kyp_schema_v2.json');
  out.push('-- Regenerate: node scripts/gen-kyp-catalog.mjs');
  out.push('--');
  out.push(`-- ${products.length} products (ProductItem) + ${guideRows.length} spec-ask rows (KypGuide).`);
  out.push('-- Deterministic ids (pi_<product_key> / kg_<product_key>_<attr_key>) make this');
  out.push('-- re-runnable: a regeneration updates labels/aliases/required/rules in place.');
  out.push('-- Vendor quotes (VendorRate) are NOT seeded — they are added per vendor.');
  out.push('');
  out.push(chunkInsert(
    'INSERT INTO ProductItem (id, key, category, name, aliases, active, createdAt, updatedAt) VALUES\n',
    prodRows,
    PRODUCT_TAIL,
  ));
  out.push('');
  out.push(chunkInsert(
    'INSERT INTO KypGuide (id, productId, attrKey, question, isRequired, sortOrder, condition, type, enumJson, minNum, maxNum, defaultValue, active, createdAt, updatedAt) VALUES\n',
    guideRows,
    GUIDE_TAIL,
  ));
  out.push('');
  return out.join('\n');
}

const products = build();
const ts = catalogTs(products);
const sql = seedSql(products);

if (process.argv.includes('--check')) {
  const stale = [];
  if (!existsSync(CATALOG_TS) || readFileSync(CATALOG_TS, 'utf8') !== ts) stale.push(CATALOG_TS);
  if (!existsSync(SEED_SQL) || readFileSync(SEED_SQL, 'utf8') !== sql) stale.push(SEED_SQL);
  if (stale.length) {
    console.error(`stale KYP artifacts (run node scripts/gen-kyp-catalog.mjs):\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`kyp-schema-parity OK (${products.length} products)`);
} else {
  writeFileSync(CATALOG_TS, ts);
  writeFileSync(SEED_SQL, sql);
  console.log(`wrote ${CATALOG_TS}`);
  console.log(`wrote ${SEED_SQL} (${products.length} products)`);
}
