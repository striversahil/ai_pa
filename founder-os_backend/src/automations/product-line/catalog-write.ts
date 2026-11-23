// catalog-write.ts — the editable-catalogue rules (founder decision 2026-11-23).
//
// Kept out of `update.ts` so the CRUD file stays under the 400-line budget and
// the "what may change in the catalogue" policy lives in one place:
//   · a spec's type / enum / bounds / label / required / order are editable;
//   · `attrKey` is immutable (every stored quote keys off it, and the spec
//     index mirrors it) — rename by add-new + delete-old;
//   · deleting a spec is BLOCKED while any quote carries a value for it, and the
//     error names the count so the UI can explain instead of guessing;
//   · a category rename is a bulk value change across the products that use it.
import { prisma } from '../../shared/prisma-d1';
import { SPEC_TYPES, type KypSpecType } from './kyp-schema';
import { keyOf } from './catalog-live';

export interface GuideTypedFields {
  type?: KypSpecType;
  enumJson?: string | null;
  minNum?: number | null;
  maxNum?: number | null;
}

function asEnumList(v: unknown): string[] | null {
  if (v === undefined) return null;
  const list = Array.isArray(v)
    ? v.map((s) => String(s).trim()).filter(Boolean)
    : String(v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  return [...new Set(list)].slice(0, 200);
}

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Typed spec fields from a request body. Only keys present in `body` are
 * returned, so a PATCH never wipes an untouched column.
 */
export function guideTypedData(body: any, isCreate = false): GuideTypedFields {
  const out: GuideTypedFields = {};
  if (isCreate || body?.type !== undefined) {
    const raw = String(body?.type ?? 'string').toLowerCase();
    out.type = (SPEC_TYPES as readonly string[]).includes(raw) ? (raw as KypSpecType) : 'string';
  }
  if (isCreate || body?.enum !== undefined || body?.enumJson !== undefined) {
    const list = asEnumList(body?.enum ?? body?.enumJson);
    out.enumJson = list && list.length ? JSON.stringify(list) : null;
  }
  if (isCreate || body?.min !== undefined || body?.minNum !== undefined) {
    out.minNum = asNumber(body?.min ?? body?.minNum);
  }
  if (isCreate || body?.max !== undefined || body?.maxNum !== undefined) {
    out.maxNum = asNumber(body?.max ?? body?.maxNum);
  }
  return out;
}

/** How many stored quotes carry a value for this spec (blocks deletion). */
export async function countSpecUsage(productId: string, attrKey: string): Promise<number> {
  try {
    const rows = await (prisma as any).$queryRawUnsafe(
      'SELECT COUNT(*) AS n FROM VendorRateSpec WHERE attrKey = ? AND rateId IN ' +
        '(SELECT id FROM VendorRate WHERE productId = ?)',
      String(attrKey),
      String(productId),
    );
    return Number((rows ?? [])[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/** Refuse a spec delete while quotes still hold a value for it. */
export async function assertGuideDeletable(guide: any): Promise<void> {
  const productId = String(guide?.productId ?? '');
  const attrKey = String(guide?.attrKey ?? '');
  if (!productId || !attrKey) return;
  const used = await countSpecUsage(productId, attrKey);
  if (used > 0) {
    throw new Error(
      `${attrKey} is used by ${used} vendor quote${used === 1 ? '' : 's'} — clear or re-file those quotes before removing this spec`,
    );
  }
}

// Category add / rename-everywhere / delete-if-empty live in
// catalog-categories.ts (they also maintain the declared list); re-exported
// here so callers get one catalogue-write surface.
export { addCategory, deleteCategory, renameCategory, readDeclaredCategories } from './catalog-categories';

/** Schema `product_key` for a new/renamed product (stable, unique-ish slug). */
export function productKeyFor(body: any, name: string): string {
  const explicit = String(body?.key ?? '').trim().toLowerCase();
  if (explicit) return explicit.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  const id = String(body?.id ?? '');
  if (id.startsWith('pi_')) return id.slice(3);
  return keyOf({ name });
}

// The default-value rule lives in spec-default.ts (pure, so the guard can
// exercise it without the D1 layer).
export { normalizeDefaultValue, parseStoredDefault } from './spec-default';
