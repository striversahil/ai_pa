import { initD1, prisma } from '../src/shared/prisma-d1';
import { fakeD1 } from './d1-mock.mjs';
import { getProductIndex, getRatesForProduct } from '../src/automations/product-line/service';
initD1({ DB: fakeD1() } as any);
async function main() {
  const now = new Date().toISOString();
  const db = prisma as any;
  await db.productItem.create({ data: { id: 'p1', category: 'Belts', name: 'V belt', aliases: '[]', active: true, createdAt: now, updatedAt: now } });
  await db.vendor.create({ data: { id: 'v1', name: 'V1', vendorType: '', active: true, createdAt: now, updatedAt: now } });
  await db.vendorRate.create({ data: { id: 'r1', vendorId: 'v1', productId: 'p1', attrValues: '{"belt_type":"B"}', attrKey: 'belt_type=B', pricePerUnit: 450, unit: 'pcs', quotedAt: now } });
  console.log('index:', JSON.stringify(await getProductIndex()));
  const { getVendorIndex } = await import('../src/automations/product-line/service');
  console.log('vendors:', JSON.stringify(await getVendorIndex()));
  const { productLineIntakeDef } = await import('../src/automations/product-line/intake');
  const fr = await productLineIntakeDef.execTool({ env: {}, me: {}, who: 'e' } as any, 'find_rate', { query: 'V belt', vendor: 'v1' });
  console.log('find_rate:', JSON.stringify(fr.result).slice(0, 500));
}
main().catch((e) => { console.error(e); process.exit(1); });
