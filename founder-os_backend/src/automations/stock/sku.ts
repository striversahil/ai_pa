// sku.ts — system-generated SKUs (CAT-0007). Never typed by the user.
import { prisma } from '../../shared/prisma-d1';

function prefixFor(category: string, productName: string): string {
  const src = String(category || '').trim() || String(productName || '').trim() || 'GEN';
  const letters = src.toUpperCase().replace(/[^A-Z]/g, '') || 'GEN';
  return letters.slice(0, 3).padEnd(3, 'X');
}

export async function generateSku(category: string, productName: string): Promise<string> {
  const prefix = prefixFor(category, productName);
  for (let attempt = 0; attempt < 25; attempt++) {
    const key = `stock:seq:${prefix}`;
    const cur = await (prisma as any).setting.findUnique({ where: { key } }).catch(() => null);
    const next = Number((cur as any)?.value ?? 0) + 1;
    await (prisma as any).setting.upsert({
      where: { key },
      update: { value: String(next) },
      create: { key, value: String(next) },
    }).catch(() => null);
    const sku = `${prefix}-${String(next).padStart(4, '0')}`;
    const exists = await (prisma as any).stockItem.findUnique({ where: { sku } }).catch(() => null);
    if (!exists) return sku;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}
