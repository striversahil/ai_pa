// bulk-chat-e2e.ts — direct execTool/executeProposal tests for the bulk chat
// def (no LLM, no HTTP): status → change-preview → apply → link → verify →
// block proposal → commit. Bundled with esbuild, run under node.
// Build: npx esbuild scripts/bulk-chat-e2e.ts --bundle --platform=node --format=cjs --outfile=/tmp/opencode/bulk-chat-e2e.cjs && node /tmp/opencode/bulk-chat-e2e.cjs
import { initD1 } from '../src/shared/prisma-d1';
import { prisma } from '../src/shared/prisma';
import { fakeD1 } from './d1-mock.mjs';
import { productLineBulkDef } from '../src/automations/bulk-import/chat';
import { getCopilot } from '../src/copilot/registry';
import { createBatch, insertRows, getBatchRows } from '../src/automations/bulk-import/store';
import { deterministicMatch } from '../src/automations/bulk-import/match-rows';

initD1({ DB: fakeD1() } as any);

let pass = 0;
let fail = 0;
function assert(name: string, cond: unknown, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${String(extra).slice(0, 300)}`); }
}

async function seed() {
  const now = new Date().toISOString();
  const db = prisma as any;
  await db.vendor.create({ data: { id: 'v1', name: 'V1 Traders', vendorType: 'Trader', active: true, createdAt: now, updatedAt: now } });
  await db.productItem.create({ data: { id: 'p1', category: 'Belts', name: 'V belt', aliases: '["v-belt"]', active: true, createdAt: now, updatedAt: now } });
  await db.kypGuide.create({ data: { id: 'g1', productId: 'p1', attrKey: 'belt_type', question: 'Belt type?', sortOrder: 0, isRequired: true, active: true, createdAt: now, updatedAt: now } });
}

async function main() {
  await seed();
  assert('registry has product-line-bulk', !!getCopilot('product-line-bulk'));
  assert('root gate allows root', productLineBulkDef.checkAccess({ isRoot: true, user: { email: 'x' } }) === null);
  assert('root gate blocks non-root', productLineBulkDef.checkAccess({ isRoot: false, scopes: ['mis'], user: { email: 'y' } })?.status === 403);

  const batch = await createBatch({ sourceKind: 'paste', sourceName: 'chat e2e', quotedAt: new Date().toISOString(), createdBy: 'e2e' });
  await insertRows(batch.id, [
    { rowNo: 1, rawText: 'V belt B-type Rs 450 per pcs', rawHash: 'h1', price: 450, unit: 'pcs', vendorId: null, vendorName: null, quotedAt: batch.quotedAt },
    { rowNo: 2, rawText: 'V belt C-type Rs 620', rawHash: 'h2', price: 620, unit: null, vendorId: null, vendorName: null, quotedAt: batch.quotedAt },
    { rowNo: 3, rawText: 'Damru ball 4inch Rs 120 nos', rawHash: 'h3', price: 120, unit: 'nos', vendorId: null, vendorName: null, quotedAt: batch.quotedAt },
  ]);
  await deterministicMatch(await getBatchRows(batch.id, undefined, 2000));
  const ctx: any = { env: {}, me: {}, who: 'e2e', batchId: batch.id };

  const st = await productLineBulkDef.execTool(ctx, 'bulk_status', {});
  assert('bulk_status totals', (st.result as any)?.total === 3, JSON.stringify(st.result));

  const ch = await productLineBulkDef.execTool(ctx, 'bulk_change', {
    field: 'unit', value: 'mtr', filter: { missingContains: 'unit' },
  });
  const prop = (ch.proposals ?? [])[0];
  assert('bulk_change proposes (no direct write)', prop?.kind === 'bulk_set_draft' && (ch.result as any)?.ops?.[0]?.matched === 1, JSON.stringify(ch.result));
  const before = (await getBatchRows(batch.id, undefined, 2000)).find((r) => r.rowNo === 2);
  assert('preview wrote nothing', before?.unit === null && before?.status === 'needs-specs');

  const ap = await productLineBulkDef.executeProposal(ctx, { kind: 'bulk_set_draft', batchId: batch.id, filter: prop.filter, patch: prop.patch });
  assert('bulk_set_draft applies', (ap.result.body as any)?.updated === 1, JSON.stringify(ap.result.body));

  // Multi-op: units + vendor in one shot, one proposal, one confirm.
  const multi = await productLineBulkDef.execTool(ctx, 'bulk_change', {
    ops: [
      { field: 'discount', value: '0', filter: { status: 'needs-specs' } },
      { field: 'vendor', value: 'V1 Traders', filter: {} },
    ],
  });
  const mprop = (multi.proposals ?? [])[0];
  assert('multi-op single proposal', mprop?.kind === 'bulk_set_draft' && Array.isArray(mprop.ops) && mprop.ops.length === 2, JSON.stringify(multi.result));
  const map = await productLineBulkDef.executeProposal(ctx, { kind: 'bulk_set_draft', batchId: batch.id, ops: mprop.ops });
  assert('multi-op applies all', (map.result.body as any)?.updated >= 3 && (map.result.body as any)?.ops === 2, JSON.stringify(map.result.body));
  const after = (await getBatchRows(batch.id, undefined, 2000)).find((r) => r.rowNo === 2);
  assert('unit set + finalized', after?.unit === 'mtr', JSON.stringify({ unit: after?.unit, status: after?.status }));

  const lk = await productLineBulkDef.execTool(ctx, 'bulk_link', {
    match: 'damru', target: { newProduct: { name: 'Damru ball', category: 'Belts' } },
  });
  const lprop = (lk.proposals ?? [])[0];
  assert('bulk_link proposes new product', lprop?.kind === 'bulk_link_draft', JSON.stringify(lk.result));
  const lap = await productLineBulkDef.executeProposal(ctx, { kind: 'bulk_link_draft', batchId: batch.id, rowIds: lprop.rowIds, patch: lprop.patch });
  assert('bulk_link_draft applies', (lap.result.body as any)?.updated === 1, JSON.stringify(lap.result.body));

  const vf = await productLineBulkDef.execTool(ctx, 'bulk_verify', {});
  assert('bulk_verify verdict present', ['READY', 'PARTIAL', 'NOT READY'].includes((vf.result as any)?.verdict), JSON.stringify(vf.result));

  // Damru is fully resolved (vendor came from the multi-op) → block proposes with ready 1.
  const bp0 = await productLineBulkDef.execTool(ctx, 'bulk_propose_block', {});
  assert('block proposes partial (ready 1)', !!(bp0.proposals ?? [])[0] && (bp0.result as any)?.ready === 1, JSON.stringify(bp0.result));

  // Finish the belt rows: specs via chat multi-op path.
  const specCh = await productLineBulkDef.execTool(ctx, 'bulk_change', {
    ops: [{ field: 'spec:belt_type', value: 'B', filter: { productContains: 'V belt' } }],
  });
  const specProp = (specCh.proposals ?? [])[0];
  assert('spec set proposes', specProp?.kind === 'bulk_set_draft', JSON.stringify(specCh.result));
  await productLineBulkDef.executeProposal(ctx, { kind: 'bulk_set_draft', batchId: batch.id, ops: specProp.ops });
  const bp = await productLineBulkDef.execTool(ctx, 'bulk_propose_block', {});
  assert('block proposed when ready', !!(bp.proposals ?? [])[0] && (bp.proposals ?? [])[0].kind === 'block_draft', JSON.stringify(bp.result));
  const cp = await productLineBulkDef.executeProposal(ctx, { kind: 'block_draft', batchId: batch.id });
  assert('block_draft commits with origin', (cp.result.body as any)?.committed === 3, JSON.stringify(cp.result.body));

  const unk = await productLineBulkDef.execTool(ctx, 'nope', {});
  assert('unknown tool errors', !!(unk.result as any)?.error);

  console.log(`\nbulk-chat-e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
