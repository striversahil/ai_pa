// catalog-categories.ts — categories you can add, rename and remove.
//
// Categories are DERIVED from `ProductItem.category`, so before 2026-11-23 a
// category existed only while a product used it. The dashboard now needs to
// create one ahead of time ("add category"), rename one everywhere, and drop an
// empty one — so the declared list lives in the `Setting` key/value table and
// `catalog-live.ts` merges it with the derived values.
//
// Every mutation here is followed by `touched()` from the caller, which busts
// `product-line:catalog:v1` and the product indexes.
import { prisma } from '../../shared/prisma';

export const CATEGORY_SETTING_KEY = 'product-line:categories';
const MAX_CATEGORY_LEN = 120;
const MAX_CATEGORIES = 200;

export function cleanCategoryName(v: unknown): string {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_CATEGORY_LEN);
}

/** Declared-only categories (products may not exist under them yet). */
export async function readDeclaredCategories(): Promise<string[]> {
  try {
    const row = await (prisma as any).setting.findUnique({ where: { key: CATEGORY_SETTING_KEY } });
    if (!row?.value) return [];
    const list = JSON.parse(String(row.value));
    return Array.isArray(list) ? list.map(cleanCategoryName).filter(Boolean).slice(0, MAX_CATEGORIES) : [];
  } catch {
    return [];
  }
}

async function writeDeclaredCategories(list: string[]): Promise<string[]> {
  const clean = [...new Set(list.map(cleanCategoryName).filter(Boolean))].sort().slice(0, MAX_CATEGORIES);
  const value = JSON.stringify(clean);
  await (prisma as any).setting.upsert({
    where: { key: CATEGORY_SETTING_KEY },
    update: { value },
    create: { key: CATEGORY_SETTING_KEY, value },
  });
  return clean;
}

async function categoryUsage(name: string): Promise<number> {
  const rows = await (prisma as any).$queryRawUnsafe(
    'SELECT COUNT(*) AS n FROM ProductItem WHERE category = ?',
    name,
  );
  return Number((rows ?? [])[0]?.n ?? 0);
}

/** Add a category that no product uses yet. */
export async function addCategory(raw: unknown): Promise<{ name: string; categories: string[] }> {
  const name = cleanCategoryName(raw);
  if (!name) throw new Error('category name required');
  const declared = await readDeclaredCategories();
  const used = await categoryUsage(name);
  if (declared.includes(name) || used > 0) throw new Error(`category "${name}" already exists`);
  const categories = await writeDeclaredCategories([...declared, name]);
  return { name, categories };
}

/** Remove a category — only while nothing is filed under it. */
export async function deleteCategory(raw: unknown): Promise<{ removed: string; categories: string[] }> {
  const name = cleanCategoryName(raw);
  if (!name) throw new Error('category name required');
  const used = await categoryUsage(name);
  if (used > 0) {
    throw new Error(`"${name}" still has ${used} product${used === 1 ? '' : 's'} — move them to another category first`);
  }
  const declared = await readDeclaredCategories();
  const categories = await writeDeclaredCategories(declared.filter((c) => c !== name));
  return { removed: name, categories };
}

/** Rename a category everywhere: every product, plus the declared list. */
export async function renameCategory(from: unknown, to: unknown): Promise<{ updated: number; from: string; to: string }> {
  const src = cleanCategoryName(from);
  const dst = cleanCategoryName(to);
  if (!src) throw new Error('current category required');
  if (!dst) throw new Error('new category name required');
  if (src === dst) return { updated: 0, from: src, to: dst };
  const clash = await categoryUsage(dst);
  if (clash > 0) throw new Error(`category "${dst}" already exists`);
  const n = await (prisma as any).$executeRawUnsafe(
    'UPDATE ProductItem SET category = ?, updatedAt = ? WHERE category = ?',
    dst,
    new Date().toISOString(),
    src,
  );
  const declared = await readDeclaredCategories();
  await writeDeclaredCategories([...declared.filter((c) => c !== src), dst]);
  return { updated: Number(n ?? 0), from: src, to: dst };
}
