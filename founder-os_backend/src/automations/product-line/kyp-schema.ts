// kyp-schema.ts — runtime view of the founder-authored KYP schema (v2).
//
// Source of truth: resources/json/kyp/bui_milling_vendor_kyp_schema_v2.json.
// The compiled form (labels, categories, aliases, typed specs, if/then rules)
// is GENERATED into kyp-catalog.ts — never hand-edited. So: products, their
// category, their aliases and the spec contract all come from the schema file;
// D1 only stores rows.
import {
  KYP_CATEGORIES,
  KYP_PRODUCTS,
  type KypProduct,
  type KypSpecProp,
  type KypSpecRule,
  type KypSpecType,
} from './kyp-catalog';

export { KYP_CATEGORIES, KYP_PRODUCTS };
export type { KypProduct, KypSpecProp, KypSpecRule, KypSpecType };

/** Spec value types the dashboard may assign (KYP schema vocabulary). */
export const SPEC_TYPES = ['string', 'number', 'integer', 'boolean', 'array'] as const;

/** `unit_of_sale` enum (schema v2). */
export const UNIT_ENUM = [
  'pcs', 'meter', 'sq_meter', 'kg', 'set', 'pair', 'packet', 'box', 'roll', 'bale', 'sheet',
] as const;

/** `vendor_type` enum (schema v2, lowercase). */
export const VENDOR_TYPE_ENUM = ['manufacturer', 'distributor', 'trader'] as const;

/** Envelope fields the founder chose to keep INSIDE the spec JSON instead of
 *  as their own VendorRate columns (decision 2026-11-23). */
export const EXTRA_SPEC_KEYS = ['brand', 'material', 'machine_make_model'] as const;

const BY_KEY = new Map<string, KypProduct>(KYP_PRODUCTS.map((p) => [p.key, p]));
const BY_LABEL = new Map<string, string>(KYP_PRODUCTS.map((p) => [p.label.toLowerCase(), p.key]));

export function kypProduct(key: string | null | undefined): KypProduct | null {
  if (!key) return null;
  return BY_KEY.get(String(key)) ?? null;
}

/** Which schema product a D1 row belongs to. Seeded products carry
 *  `id = pi_<product_key>`; hand-added ones are matched on their name. */
export function resolveProductKey(productId: unknown, productName?: unknown): string | null {
  const id = String(productId ?? '');
  if (id.startsWith('pi_') && BY_KEY.has(id.slice(3))) return id.slice(3);
  if (BY_KEY.has(id)) return id;
  const name = String(productName ?? '').trim().toLowerCase();
  if (name && BY_LABEL.has(name)) return BY_LABEL.get(name)!;
  return null;
}

export function productCategory(key: string | null | undefined): string | null {
  return kypProduct(key)?.category ?? null;
}

export function productAliases(key: string | null | undefined): string[] {
  return kypProduct(key)?.aliases ?? [];
}

export interface SpecIssue {
  field: string;
  message: string;
}

export type SpecValue = string | number | boolean | string[];

export interface SpecCheck {
  ok: boolean;
  errors: SpecIssue[];
  /** Schema-required spec keys with no value. */
  missing: string[];
  /** Type-clean values, empty strings dropped, unknown keys removed. */
  specs: Record<string, SpecValue>;
}

const isBlank = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
}

function checkProp(prop: KypSpecProp, key: string, raw: unknown, errors: SpecIssue[]): SpecValue | undefined {
  if (prop.type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true' || raw === 1 || raw === '1') return true;
    if (raw === 'false' || raw === 0 || raw === '0') return false;
    errors.push({ field: key, message: `${prop.label}: must be true or false` });
    return undefined;
  }
  if (prop.type === 'array') {
    const list = Array.isArray(raw) ? raw : String(raw).split(/[,;]/);
    const out = list.map((v) => String(v).trim()).filter(Boolean);
    if (!out.length) return undefined;
    return out;
  }
  if (prop.type === 'number' || prop.type === 'integer') {
    const n = asNumber(raw);
    if (n === null) {
      errors.push({ field: key, message: `${prop.label}: must be a number` });
      return undefined;
    }
    if (prop.type === 'integer' && !Number.isInteger(n)) {
      errors.push({ field: key, message: `${prop.label}: must be a whole number` });
      return undefined;
    }
    if (prop.gt !== undefined && !(n > prop.gt)) {
      errors.push({ field: key, message: `${prop.label}: must be greater than ${prop.gt}` });
      return undefined;
    }
    if (prop.min !== undefined && n < prop.min) {
      errors.push({ field: key, message: `${prop.label}: must be at least ${prop.min}` });
      return undefined;
    }
    if (prop.max !== undefined && n > prop.max) {
      errors.push({ field: key, message: `${prop.label}: must be at most ${prop.max}` });
      return undefined;
    }
    return n;
  }
  const s = String(raw).trim();
  if (prop.minLen !== undefined && s.length < prop.minLen) {
    errors.push({ field: key, message: `${prop.label}: too short` });
    return undefined;
  }
  if (prop.enum && !prop.enum.includes(s)) {
    errors.push({ field: key, message: `${prop.label}: must be one of ${prop.enum.join(', ')}` });
    return undefined;
  }
  return s;
}

export function validateSpecs(productKey: string | null, raw: unknown): SpecCheck {
  return validateSpecsFor(kypProduct(productKey), raw);
}

/**
 * Typecheck a rate's specs against ONE catalogue product (compiled seed or the
 * live D1 catalogue — `catalog-live.ts`).
 * Unknown keys are rejected (schema uses additionalProperties:false); the three
 * envelope extras (brand/material/machine_make_model) are accepted everywhere.
 */
export function validateSpecsFor(product: KypProduct | null, raw: unknown): SpecCheck {
  const productKey = product?.key ?? null;
  const errors: SpecIssue[] = [];
  const specs: Record<string, SpecValue> = {};
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const allowed = new Set<string>([...EXTRA_SPEC_KEYS, ...Object.keys(product?.props ?? {})]);

  for (const [key, value] of Object.entries(src)) {
    if (isBlank(value)) continue;
    if (!allowed.has(key)) {
      errors.push({ field: key, message: `${key}: not a spec of ${productKey ?? 'this product'}` });
      continue;
    }
    const prop = product?.props[key];
    if (!prop) {
      specs[key] = String(value).trim();
      continue;
    }
    const clean = checkProp(prop, key, value, errors);
    if (clean !== undefined) specs[key] = clean;
  }

  // if/then bounds: e.g. grade=GG bounds grade_number to 6..74.
  for (const rule of product?.rules ?? []) {
    if (specs[rule.whenKey] === undefined) continue;
    if (String(specs[rule.whenKey]) !== rule.whenValue) continue;
    const v = specs[rule.key];
    if (typeof v !== 'number') continue;
    if (rule.min !== undefined && v < rule.min) {
      errors.push({ field: rule.key, message: `${product!.props[rule.key]?.label ?? rule.key}: must be at least ${rule.min} when ${rule.whenKey} is ${rule.whenValue}` });
    }
    if (rule.max !== undefined && v > rule.max) {
      errors.push({ field: rule.key, message: `${product!.props[rule.key]?.label ?? rule.key}: must be at most ${rule.max} when ${rule.whenKey} is ${rule.whenValue}` });
    }
  }

  const missing = (product?.required ?? []).filter((k) => specs[k] === undefined);
  return { ok: errors.length === 0, errors, missing, specs };
}

/** Envelope check for a vendor quote (the schema's non-spec columns). */
export interface EnvelopeInput {
  unit?: unknown;
  moq?: unknown;
  pricePerUnit?: unknown;
  discountPercent?: unknown;
  deliveryDays?: unknown;
  deliveryMaxDays?: unknown;
  quotedAt?: unknown;
}

export function validateEnvelope(input: EnvelopeInput): { errors: SpecIssue[]; missing: string[] } {
  const errors: SpecIssue[] = [];
  const missing: string[] = [];

  const unit = String(input.unit ?? '').trim();
  if (!unit) missing.push('unit_of_sale');
  else if (!(UNIT_ENUM as readonly string[]).includes(unit)) {
    errors.push({ field: 'unit', message: `unit: must be one of ${UNIT_ENUM.join(', ')}` });
  }

  const moq = String(input.moq ?? '').trim();
  if (!moq) missing.push('moq');
  else if (!/^\d+$/.test(moq) || Number(moq) < 1) {
    errors.push({ field: 'moq', message: 'moq: must be a whole number of at least 1' });
  }

  const price = asNumber(input.pricePerUnit);
  if (input.pricePerUnit == null || input.pricePerUnit === '') missing.push('price_per_unit');
  else if (price === null || price <= 0) errors.push({ field: 'pricePerUnit', message: 'price: must be greater than 0' });

  const disc = asNumber(input.discountPercent);
  if (disc !== null && (disc < 0 || disc > 100)) {
    errors.push({ field: 'discountPercent', message: 'discount: must be between 0 and 100' });
  }

  const days = asNumber(input.deliveryDays);
  if (days === null) missing.push('delivery_time_days');
  else if (!Number.isInteger(days) || days < 0) {
    errors.push({ field: 'deliveryDays', message: 'delivery days: must be a whole number of days' });
  }
  const maxDays = asNumber(input.deliveryMaxDays);
  if (maxDays !== null) {
    if (!Number.isInteger(maxDays) || maxDays < 0) {
      errors.push({ field: 'deliveryMaxDays', message: 'max delivery days: must be a whole number of days' });
    } else if (days !== null && maxDays < days) {
      errors.push({ field: 'deliveryMaxDays', message: 'max delivery days: must not be less than the minimum' });
    }
  }

  if (input.quotedAt == null || input.quotedAt === '') missing.push('date_added');

  return { errors, missing };
}

/** One typed index row per spec value (see spec-index.ts). */
export function specIndexRows(specs: Record<string, unknown>): { attrKey: string; valueText: string; valueNum: number | null }[] {
  const rows: { attrKey: string; valueText: string; valueNum: number | null }[] = [];
  for (const [attrKey, value] of Object.entries(specs ?? {})) {
    if (isBlank(value)) continue;
    if (Array.isArray(value)) {
      rows.push({ attrKey, valueText: value.map(String).join(', '), valueNum: null });
      continue;
    }
    const text = String(value);
    rows.push({ attrKey, valueText: text, valueNum: typeof value === 'number' ? value : asNumber(value) });
  }
  return rows;
}
