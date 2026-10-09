// intake-e2e.ts — direct tests: normalizer, stateless capture, table-first
// commit_all proposal (create + upsert-no-duplicate), correction updates,
// missingSpecs. Bundled with esbuild (D1 redirects), run under node.
import { initD1, prisma } from '../src/shared/prisma-d1';
import { fakeD1 } from './d1-mock.mjs';
import { normalizeInches, normalizeSpecValue, normalizeUnit } from '../src/automations/product-line/normalize';
import { canonicalAttrKey, resolveSpecKeys } from '../src/automations/product-line/intake';
import { productLineIntakeDef } from '../src/automations/product-line/intake';

initD1({ DB: fakeD1() } as any);

let pass = 0;
let fail = 0;
function assert(name: string, cond: unknown, extra = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${String(extra).slice(0, 300)}`); }
}

async function main() {
  const now = new Date().toISOString();
  const db = prisma as any;
  await db.productItem.create({ data: { id: 'p1', category: 'Belts', name: 'V belt', aliases: '[]', active: true, createdAt: now, updatedAt: now } });
  await db.kypGuide.create({ data: { id: 'g1', productId: 'p1', attrKey: 'belt_type', question: 'Belt type?', sortOrder: 0, isRequired: true, active: true, createdAt: now, updatedAt: now } });
  await db.kypGuide.create({ data: { id: 'g2', productId: 'p1', attrKey: 'width_inch', question: 'Width?', sortOrder: 1, isRequired: true, active: true, createdAt: now, updatedAt: now } });

  assert('intake keeps tool outputs across turns', (productLineIntakeDef as any)?.keepToolOutputs === true);
  assert('intake has no step ceiling', (productLineIntakeDef as any)?.maxSteps === Number.POSITIVE_INFINITY);
assert('intake uncapped inputs', (productLineIntakeDef as any)?.toolResultCap === 64000 && (productLineIntakeDef as any)?.traceCap === 128000 && (productLineIntakeDef as any)?.historyRecentCap === 64000 && (productLineIntakeDef as any)?.historyTotalCap === 200000);
assert('intake fans out in parallel', (productLineIntakeDef as any)?.maxParallelTools === 8);
  assert('normalize 4"', normalizeInches('Nylon 4"') === 'Nylon 4 inch');
  assert('normalize mtr', normalizeUnit('mtr') === 'meter');
  assert('canonical key order-free', canonicalAttrKey({ b: '2', a: '1' }) === 'a=1|b=2');

  const ctx: any = { env: {}, me: {}, who: 'e2e' };
  const def = productLineIntakeDef;

  // Blob of 3 quotes → split (stateless: heads only, nothing stored).
  const sp = await def.execTool(ctx, 'split_quotes', { quotes: [{ text: 'V belt B 450 pcs' }, { text: 'V belt C 620 pcs' }, { text: 'Damru 120 nos' }] });
  assert('split 3 quotes, stateless', (sp.result as any)?.drafts === 3, JSON.stringify(sp.result));

  // No input caps: 60 quotes split whole, 25 rates commit whole.
  const many = await def.execTool(ctx, 'split_quotes', { quotes: Array.from({ length: 60 }, (_, i) => ({ text: `Quote ${i + 1} V belt ${100 + i} pcs` })) });
  assert('split uncapped (60 whole)', (many.result as any)?.drafts === 60, JSON.stringify((many.result as any)?.drafts));
  const manyRates = Array.from({ length: 25 }, (_, i) => ({ productName: `P${i + 1}`, productCategory: 'Belts', vendorName: 'V1', price: 100 + i, unit: 'pcs' }));
  const caBig = await def.execTool(ctx, 'commit_all', { rates: manyRates });
  assert('commit uncapped (25 rows)', ((caBig as any)?.proposals?.[0]?.table?.rows?.length ?? 0) === 25, JSON.stringify((caBig.result as any)));

  // Capture each (stateless update_draft returns normalized structure).
  const fill = [
    { label: '#1', productId: 'p1', productName: 'V belt', vendorName: 'V1', price: 450, unit: 'pcs', specs: { belt_type: 'B' } },
    { label: '#2', productId: 'p1', productName: 'V belt', vendorName: 'V1', price: 620, unit: 'pcs', specs: { belt_type: 'C' } },
    { label: '#3', productName: 'Damru ball', productCategory: 'Belts', vendorName: 'V1', price: 120, unit: 'nos', specs: {} },
  ];
  const captured: any[] = [];
  for (const f of fill) {
    const r = await def.execTool(ctx, 'update_draft', f);
    captured.push((r.result as any));
  }
  assert('capture normalizes + reports gaps', captured.every((c: any) => c && c.draft && Array.isArray(c.missing)), JSON.stringify(captured.map((c: any) => c?.missing)));

  // Table-first: ONE consolidated proposal for all three (nothing filed yet).
  const ca = await def.execTool(ctx, 'commit_all', { rates: fill });
  const cprop = (ca as any)?.proposals?.[0];
  assert('commit_all proposes, writes nothing', cprop?.kind === 'commit_all_draft', JSON.stringify({ proposals: (ca as any)?.proposals?.map((p: any) => p.kind) }));
  assert('proposal carries table + full payloads', Array.isArray(cprop?.table?.rows) && cprop.table.rows.length === 3 && Array.isArray(cprop?.rates), JSON.stringify(cprop?.table));
  assert('no rates before Confirm', ((await db.vendorRate.findMany({})) as any[]).length === 0);

  // Execute the proposal directly (what Confirm does).
  const execRes = await (def.executeProposal as any)(ctx, { kind: 'commit_all_draft', rates: cprop.rates });
  const body = (execRes as any)?.result?.body ?? {};
  assert('commit_all_draft filed 3 (Damru auto-created)', ((body.filed ?? []) as any[]).length === 3 && ((body.failed ?? []) as any[]).length === 0, JSON.stringify(body));
  assert('spec gaps flagged, not blocking', ((body.filed ?? []) as any[]).every((f: any) => (f.missing ?? []).length > 0), JSON.stringify((body.filed ?? []).map((f: any) => f.missing)));
  const rates1 = ((await db.vendorRate.findMany({})) as any[]);
  assert('3 live rates', rates1.length === 3, String(rates1.length));

  // Re-file identical payloads → updates, zero new rows.
  const exec2 = await (def.executeProposal as any)(ctx, { kind: 'commit_all_draft', rates: cprop.rates });
  const body2 = (exec2 as any)?.result?.body ?? {};
  assert('refile updates all (no duplicates)', ((body2.filed ?? []) as any[]).every((f: any) => f.updated === true), JSON.stringify(body2));
  assert('still 3 rates', ((await db.vendorRate.findMany({})) as any[]).length === 3);

  // Later correction (width for #1) updates the SAME rate.
  const fixed = [{ ...fill[0], specs: { belt_type: 'B', width_inch: '4 inch' } }];
  const exec3 = await (def.executeProposal as any)(ctx, { kind: 'commit_all_draft', rates: fixed });
  const body3 = (exec3 as any)?.result?.body ?? {};
  assert('correction updates in place', ((body3.filed ?? []) as any[]).length === 1 && (body3.filed as any[])[0].updated === true, JSON.stringify(body3));
  const rates3 = ((await db.vendorRate.findMany({})) as any[]);
  assert('still 3 rates', rates3.length === 3);
  assert('width landed on the SAME rate', rates3.some((r: any) => String(r.attrValues ?? '').includes('width_inch')), JSON.stringify(rates3.map((r: any) => r.attrValues)));

  // find_rate + update_rate direct correction path.
  const fr = await def.execTool(ctx, 'find_rate', { query: 'V belt', vendor: 'v1' });
  assert('find_rate locates filed rates', ((fr.result as any)?.rates ?? []).length >= 2, JSON.stringify(fr.result));
  const target = ((fr.result as any).rates as any[])[0];
  const ur = await def.execTool(ctx, 'update_rate', { rateId: target.rateId, moq: '10 pcs', specs: { width_inch: '4 inch' } } as any);
  assert('update_rate patches + recomputes gaps', (ur.result as any)?.updated === true, JSON.stringify(ur.result));
  assert('still 3 rates after correction', ((await db.vendorRate.findMany({})) as any[]).length === 3);

  // update_vendor direct correction path (vendor V1 was auto-created on filing).
  const fv = await def.execTool(ctx, 'find_vendor', { query: 'V1' });
  const v1 = ((fv.result as any)?.vendors as any[])?.[0];
  assert('find_vendor locates V1', !!v1?.id, JSON.stringify(fv.result));
  const uv = await def.execTool(ctx, 'update_vendor', { vendorId: v1.id, phone: '9811111111', location: 'Delhi' });
  assert('update_vendor patches details', (uv.result as any)?.updated === true, JSON.stringify(uv.result));
  const vRow = await (db.vendor.findUnique({ where: { id: v1.id } }) as any);
  assert('phone + location landed', vRow?.contactPhone1 === '9811111111' && vRow?.location === 'Delhi', JSON.stringify(vRow));

  // Flexible reads: paging + field expansion (the AI pulls what it needs).
  const fp = await def.execTool(ctx, 'find_product', { query: '', limit: 1, include: ['quotes', 'checklist'] });
  const fpr = fp.result as any;
  assert('find_product lists all, paged', fpr.total >= 1 && fpr.products.length === 1 && fpr.truncated === (fpr.total > 1), JSON.stringify({ total: fpr.total, n: fpr.products.length }));
  assert('find_product expands quotes+checklist', Array.isArray(fpr.products[0]?.quotes) && fpr.products[0].quotes.length >= 1 && Array.isArray(fpr.products[0]?.checklist) && fpr.products[0].checklist.length >= 1, JSON.stringify({ q: fpr.products[0]?.quotes?.length, c: fpr.products[0]?.checklist?.length }));
  const fvx = await def.execTool(ctx, 'find_vendor', { query: '', limit: 50, include: ['rates', 'contact'] });
  const fvr = fvx.result as any;
  const v1e = (fvr.vendors as any[])?.find((v: any) => v.name === 'V1');
  assert('find_vendor expands contact+rates', v1e?.contactPhone1 === '9811111111' && Array.isArray(v1e?.rates) && v1e.rates.length >= 3, JSON.stringify({ ph: v1e?.contactPhone1, n: v1e?.rates?.length }));
  const frAll = await def.execTool(ctx, 'find_rate', { limit: 50 });
  const frAllR = frAll.result as any;
  assert('find_rate no-filter lists whole book', frAllR.total === 3 && frAllR.rates.length === 3 && frAllR.truncated === false, JSON.stringify({ total: frAllR.total }));
  const frp = await def.execTool(ctx, 'find_rate', { query: 'V belt', limit: 1, offset: 1, include: ['commercials'] });
  const frpr = frp.result as any;
  assert('find_rate pages + commercials', frpr.rates.length === 1 && frpr.total >= 2 && frpr.truncated === true && 'moq' in ((frpr.rates[0] as any)?.commercials ?? {}), JSON.stringify({ n: frpr.rates.length, total: frpr.total }));

  // KEY FIDELITY: vendor-worded keys resolve to real attrKeys; leftovers
  // ride in notes and are NEVER stored as spec keys.
  const kGuide = [
    { attrKey: 'ask_material_ms_regular', question: 'Ask material: MS or SS' },
    { attrKey: 'ask_size_width', question: 'Ask size width x projection x depth' },
    { attrKey: 'ask_quantity', question: 'Ask quantity' },
  ];
  const rk = resolveSpecKeys({ material: 'MS', Size: '4 inch', brand: 'JINDAL', 'delivery note': 'ready' }, kGuide);
  assert('invented keys resolve to attrKeys', rk.mapped['ask_material_ms_regular'] === 'MS' && rk.mapped['ask_size_width'] === '4 inch' && !('material' in rk.mapped) && !('Size' in rk.mapped), JSON.stringify(rk));
  assert('non-specs go unmapped, never stored', rk.unmapped.length === 2, JSON.stringify(rk.unmapped));
  const rk2 = resolveSpecKeys({ 'ask size width x projection x depth': '6 inch', ask_size_width: '4 inch' }, kGuide);
  assert('twin-key clash joins visibly + flagged', rk2.mapped['ask_size_width'] === '6 inch / 4 inch' && rk2.conflicts.length === 1, JSON.stringify(rk2));
  const kGuide2 = [
    { attrKey: 'ask_diameter_mm', question: 'Ask diameter in mm, and hardness if known' },
    { attrKey: 'ask_bounce_type', question: 'Ask bounce type: high or medium bounce' },
    { attrKey: 'ask_quantity_moq', question: 'Ask quantity, MOQ 500 pcs' },
    { attrKey: 'ask_make_model', question: 'Ask the elevator make and model' },
  ];
  const rk3 = resolveSpecKeys({ size: '28mm', bounce: 'H.B', qty: '1000', brand: 'JINDAL', 'price basis': 'net' }, kGuide2);
  assert('synonyms resolve (size→diameter, qty→quantity, brand→make)', rk3.mapped['ask_diameter_mm'] === '28mm' && rk3.mapped['ask_bounce_type'] === 'H.B' && rk3.mapped['ask_quantity_moq'] === '1000' && rk3.mapped['ask_make_model'] === 'JINDAL', JSON.stringify(rk3));
  assert('commercial chatter stays unmapped', rk3.unmapped.length === 1 && rk3.unmapped[0].key === 'price basis', JSON.stringify(rk3.unmapped));
  // Milling-spares trade: GZ folds to gauge, per-pc folds to pcs, jali/mesh
  // and SS shorthands resolve like their checklist words.
  assert('GZ normalizes to gauge', normalizeSpecValue('28 GZ') === '28 gauge' && normalizeSpecValue('18GZ') === '18 gauge', JSON.stringify([normalizeSpecValue('28 GZ'), normalizeSpecValue('18GZ')]));
  assert('per-pc folds to pcs', normalizeUnit('per pc') === 'pcs' && normalizeUnit('Per Pc') === 'pcs', JSON.stringify([normalizeUnit('per pc'), normalizeUnit('Per Pc')]));
  const kGuide3 = [
    { attrKey: 'ask_mesh_type', question: 'Ask mesh type: perforated sheet or wire mesh' },
    { attrKey: 'ask_material_ss_or_ms', question: 'Ask material: SS304 or MS' },
  ];
  const rk4 = resolveSpecKeys({ jali: 'wire mesh', SS: 'SS304' }, kGuide3);
  assert('trade synonyms resolve (jali→mesh, SS→stainless)', rk4.mapped['ask_mesh_type'] === 'wire mesh' && rk4.mapped['ask_material_ss_or_ms'] === 'SS304', JSON.stringify(rk4));
  const udK = await def.execTool(ctx, 'update_draft', { productId: 'p1', productName: 'V belt', vendorName: 'V1', price: 100, unit: 'pcs', specs: { Belt: 'B', Width: '4 inch', Color: 'red' } });
  const ddK = (udK.result as any)?.draft;
  assert('update_draft resolves invented keys', ddK?.specs?.belt_type === 'B' && ddK?.specs?.width_inch === '4 inch' && !('Belt' in (ddK?.specs ?? {})) && !('Color' in (ddK?.specs ?? {})), JSON.stringify(ddK?.specs));
  assert('update_draft leftovers land in notes', String(ddK?.notes ?? '').includes('Color'), JSON.stringify(ddK?.notes));
  const ck = await def.execTool(ctx, 'commit_all', { rates: [{ productId: 'p1', productName: 'V belt', vendorName: 'V9', price: 200, unit: 'pcs', specs: { Belt: 'C', 'delivery note': 'ready' } }] });
  const ckProp = (ck as any)?.proposals?.[0];
  const ckExec = await (def.executeProposal as any)(ctx, { kind: 'commit_all_draft', rates: ckProp.rates });
  const ckFiled = ((ckExec as any)?.result?.body?.filed ?? [])[0];
  const ckRow = ckFiled ? await (db.vendorRate.findUnique({ where: { id: ckFiled.rateId } }) as any) : null;
  const ckVals = JSON.parse(String(ckRow?.attrValues ?? '{}'));
  assert('commit files resolved keys only', ckVals?.belt_type === 'C' && !('Belt' in ckVals), JSON.stringify(ckVals));
  assert('commit persists notes', String(ckRow?.notes ?? '').includes('delivery note'), JSON.stringify(ckRow?.notes));
  const ckDel = await (def as any).executeProposal(ctx, { kind: 'delete_rate', rateId: ckFiled.rateId });
  assert('cleanup fidelity test rate', (ckDel as any)?.applied === 'delete_rate', JSON.stringify((ckDel as any)?.result?.body));

  // delete_vendor blocked while rates reference it.
  const dvBlocked = await def.execTool(ctx, 'delete_vendor', { vendorId: v1.id });
  assert('delete_vendor blocked with live rates', typeof (dvBlocked.result as any)?.error === 'string', JSON.stringify(dvBlocked.result));

  // delete_rate proposes (nothing deleted yet), executes on Confirm.
  const dr = await def.execTool(ctx, 'delete_rate', { rateId: target.rateId });
  assert('delete_rate proposes, writes nothing', (dr as any)?.proposals?.[0]?.kind === 'delete_rate', JSON.stringify((dr as any)?.proposals?.map((p: any) => p.kind)));
  assert('still 3 rates before Confirm', ((await db.vendorRate.findMany({})) as any[]).length === 3);
  const execDel = await (def as any).executeProposal(ctx, { kind: 'delete_rate', rateId: target.rateId });
  assert('delete_rate executes on Confirm', (execDel as any)?.applied === 'delete_rate', JSON.stringify((execDel as any)?.result?.body));
  assert('2 rates after delete', ((await db.vendorRate.findMany({})) as any[]).length === 2);

  // Delete remaining rates, then the vendor delete goes through.
  const rest = ((await db.vendorRate.findMany({})) as any[]);
  for (const r of rest) {
    const e = await (def as any).executeProposal(ctx, { kind: 'delete_rate', rateId: r.id });
    assert(`deleted rate ${r.id}`, (e as any)?.applied === 'delete_rate', JSON.stringify((e as any)?.result?.body));
  }
  const dv = await def.execTool(ctx, 'delete_vendor', { vendorId: v1.id });
  assert('delete_vendor proposes once rates gone', (dv as any)?.proposals?.[0]?.kind === 'delete_vendor', JSON.stringify(dv.result));
  const execVDel = await (def as any).executeProposal(ctx, { kind: 'delete_vendor', vendorId: v1.id });
  assert('delete_vendor executes on Confirm', (execVDel as any)?.applied === 'delete_vendor', JSON.stringify((execVDel as any)?.result?.body));

  // Fuzzy vendor matching: canon-equal names clash instead of duplicating.
  const acmeFile = await (def as any).executeProposal(ctx, { kind: 'commit_all_draft', rates: [{ productId: 'p1', vendorName: 'M/S Acme Traders', price: 200, unit: 'pcs', specs: { belt_type: 'D' } }] });
  assert('acme rate filed', ((acmeFile as any)?.result?.body?.filed ?? []).length === 1, JSON.stringify((acmeFile as any)?.result?.body));
  const acmeClash = await def.execTool(ctx, 'propose_vendor', { name: 'acme traders' });
  assert('canon-equal vendor clashes with id', !!(acmeClash.result as any)?.error && !!(acmeClash.result as any)?.vendorId, JSON.stringify(acmeClash.result));
  const acmeDupe = await (def as any).executeProposal(ctx, { kind: 'vendor_draft', name: 'Acme Traders Delhi' });
  assert('near-dupe vendor created for merge test', (acmeDupe as any)?.applied === 'vendor_draft', JSON.stringify((acmeDupe as any)?.result?.body));
  const dupId = String((acmeDupe as any)?.result?.body?.id ?? '');
  const dupScan = await def.execTool(ctx, 'find_duplicates', { scope: 'vendors' });
  const pair = ((dupScan.result as any)?.groups as any[])?.find((g) => [g.a.id, g.b.id].includes(dupId));
  assert('find_duplicates spots the pair', !!pair, JSON.stringify((dupScan.result as any)?.groups));
  // Give the dupe a rate, then merge it into the survivor.
  const dupeRate = await (def as any).executeProposal(ctx, { kind: 'commit_all_draft', rates: [{ productId: 'p1', vendorId: dupId, price: 210, unit: 'pcs', specs: { belt_type: 'E' } }] });
  assert('dupe rate filed', ((dupeRate as any)?.result?.body?.filed ?? []).length === 1, JSON.stringify((dupeRate as any)?.result?.body));
  const mv = await def.execTool(ctx, 'merge_vendor', { fromVendorId: dupId, intoVendorId: (acmeClash.result as any).vendorId });
  assert('merge_vendor proposes with count', (mv as any)?.proposals?.[0]?.kind === 'merge_vendor', JSON.stringify(mv.result));
  const mvExec = await (def as any).executeProposal(ctx, { kind: 'merge_vendor', fromVendorId: dupId, intoVendorId: (acmeClash.result as any).vendorId });
  assert('merge_vendor moves rate + deletes loser', (mvExec as any)?.applied === 'merge_vendor' && (mvExec as any)?.result?.body?.moved === 1, JSON.stringify((mvExec as any)?.result?.body));
  const dupeGone = await (db.vendor.findUnique({ where: { id: dupId } }) as any);
  assert('loser vendor gone', dupeGone == null, JSON.stringify(dupeGone));

  // Product merge: aliases union, rate moved, checklist carried, loser gone.
  await db.productItem.create({ data: { id: 'p2', category: 'Belts', name: 'Vee Belt', aliases: '[]', active: true, createdAt: now, updatedAt: now } });
  await db.kypGuide.create({ data: { id: 'g3', productId: 'p2', attrKey: 'length_inch', question: 'Length?', sortOrder: 0, isRequired: false, active: true, createdAt: now, updatedAt: now } });
  const pdupe = await (def as any).executeProposal(ctx, { kind: 'commit_all_draft', rates: [{ productId: 'p2', vendorName: 'MVendor', price: 300, unit: 'pcs', specs: { length_inch: '10 inch' } }] });
  assert('p-dupe rate filed', ((pdupe as any)?.result?.body?.filed ?? []).length === 1, JSON.stringify((pdupe as any)?.result?.body));
  const mp = await def.execTool(ctx, 'merge_product', { fromProductId: 'p2', intoProductId: 'p1' });
  assert('merge_product proposes with preview', (mp as any)?.proposals?.[0]?.kind === 'merge_product', JSON.stringify(mp.result));
  const mpExec = await (def as any).executeProposal(ctx, { kind: 'merge_product', fromProductId: 'p2', intoProductId: 'p1' });
  const mpBody = (mpExec as any)?.result?.body ?? {};
  assert('merge_product moves + carries guide + aliases', (mpExec as any)?.applied === 'merge_product' && mpBody.moved === 1 && mpBody.guideCarry === 1 && (mpBody.aliasAdds ?? []).includes('Vee Belt'), JSON.stringify(mpBody));
  const p2gone = await (db.productItem.findUnique({ where: { id: 'p2' } }) as any);
  assert('loser product gone', p2gone == null, JSON.stringify(p2gone));
  const dpBlocked = await def.execTool(ctx, 'delete_product', { productId: 'p1' });
  assert('delete_product blocked points to merge', typeof (dpBlocked.result as any)?.error === 'string' && String((dpBlocked.result as any)?.error).includes('merge_product'), JSON.stringify(dpBlocked.result));

  // Dedupe registry: identical re-fires refused (the 19-duplicate-cards loop).
  const ctx3: any = { env: {}, me: {}, who: 'e2e', session: 'dupetest' };
  const pv1 = await def.execTool(ctx3, 'propose_vendor', { name: 'Dupe Traders', phone: '9111111111' });
  assert('first vendor draft proposed', (pv1.result as any)?.proposed === true, JSON.stringify(pv1.result));
  const pv2 = await def.execTool(ctx3, 'propose_vendor', { name: 'Dupe Traders', phone: '9111111111' });
  assert('identical vendor re-fire refused', (pv2.result as any)?.duplicate === true, JSON.stringify(pv2.result));
  const pv3 = await def.execTool(ctx3, 'propose_vendor', { name: 'Dupe Traders', phone: '9222222222' });
  assert('corrected phone still drafts', (pv3.result as any)?.proposed === true, JSON.stringify(pv3.result));
  const pp1 = await def.execTool(ctx3, 'propose_product', { name: 'New Widget', category: 'Belts' });
  assert('first product draft proposed', (pp1.result as any)?.proposed === true, JSON.stringify(pp1.result));
  const pp2 = await def.execTool(ctx3, 'propose_product', { name: 'New Widget', category: 'Belts' });
  assert('identical product re-fire refused', (pp2.result as any)?.duplicate === true, JSON.stringify(pp2.result));

  console.log(`\nintake-e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
