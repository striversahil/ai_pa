// Offline harness: drives the REAL execTool batch branches with stubbed
// storage (service/cache/store), no D1/LLM. Run from founder-os_backend:
//   node scripts/batch-e2e.mjs
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'batch-e2e-'));

// ── Stubs ──
const kv = new Map();
writeFileSync(join(dir, 'cache.mjs'), `
export const kv = new Map();
export async function cacheGet(k){ return kv.has(k) ? kv.get(k) : null; }
export async function cacheSet(k, v){ kv.set(k, v); }
export async function cacheDel(k){ kv.delete(k); }
`);
writeFileSync(join(dir, 'service.mjs'), `
const products = [
  { id: 'p-pvc', category: 'PVC Sheets', name: 'PVC Foam Board 18mm', aliases: ['pvc board', 'pvc foam'], active: true },
  { id: 'p-acr', category: 'Acrylic', name: 'Acrylic Sheet 5mm Clear', aliases: ['acrylic sheet'], active: true },
];
const guide = {
  'p-pvc': [
    { attrKey: 'thickness', question: 'Thickness?', guideNote: null, sortOrder: 1, isRequired: true, active: true },
    { attrKey: 'size', question: 'Sheet size?', guideNote: null, sortOrder: 2, isRequired: true, active: true },
  ],
  'p-acr': [
    { attrKey: 'thickness', question: 'Thickness?', guideNote: null, sortOrder: 1, isRequired: true, active: true },
    { attrKey: 'size', question: 'Sheet size?', guideNote: null, sortOrder: 2, isRequired: true, active: true },
  ],
};
const rates = {
  'p-pvc': [
    { id: 'r1', productId: 'p-pvc', attrValues: { thickness: '18mm', size: '8x4 ft' }, pricePerUnit: 1450, unit: 'sheet', discountPercent: 0, moq: '10 sheets', deliveryDays: 3, quotedAt: new Date().toISOString(), active: true },
    { id: 'r2', productId: 'p-pvc', attrValues: { thickness: '12mm', size: '8x4 ft' }, pricePerUnit: 1100, unit: 'sheet', discountPercent: 0, moq: null, deliveryDays: 5, quotedAt: new Date().toISOString(), active: true },
  ],
  'p-acr': [],
};
export async function getProductIndex(){ return products; }
export async function getProductDetail(id){ return { guide: guide[id] ?? [] }; }
export async function getRatesForProduct(id){ return rates[id] ?? []; }
`);
writeFileSync(join(dir, 'routes.mjs'), `
export async function enquiryAddComment(){ return {}; }
export async function enquiryUpdate(){ return {}; }
export function canManageRates(){ return false; }
export function isRestrictedViewer(){ return false; }
export function stripMarginFields(e){ return e; }
export function canSeeProcurementRequests(){ return true; }
`);
writeFileSync(join(dir, 'engine.mjs'), `
export async function clearState(){}
export async function runTurn(){ return { reply: '' }; }
export async function* streamTurn(){}
`);
writeFileSync(join(dir, 'entry.ts'), `
import { salesCopilotDef } from '${root}/src/modules/enquiries/chat';
const store = {
  async getEnquiry() {
    return {
      id: 'enq-test', items: [
        { name: 'PVC Foam Board', kypItem: 'PVC Foam Board 18mm', category: 'PVC Sheets' },
        { name: 'Acrylic Sheet', kypItem: 'Acrylic Sheet 5mm', category: 'Acrylic' },
      ],
    };
  },
};
const me = { user: { email: 'test@example.com' } };
const ctx: any = { env: {}, store, me, enquiryId: 'enq-test', restricted: false, privileged: false };
const flat = (o: any) => JSON.parse(JSON.stringify(o));
const results: any[] = [];
const check = (name: string, cond: boolean, extra?: any) => {
  results.push({ name, pass: !!cond, extra });
  if (!cond) { console.error('FAIL:', name, JSON.stringify(extra ?? null).slice(0, 400)); process.exitCode = 1; }
  else console.log('PASS:', name);
};
const defs: any[] = (salesCopilotDef as any).toolDefs(ctx);
const names = defs.map((d: any) => d.function.name);
check('tool defs include batch tools', names.includes('find_price_batch') && names.includes('quote_price_batch'), names);
const exec = (salesCopilotDef as any).execTool;
// 1. batch resolve both items
const b1: any = flat(await exec(ctx, 'find_price_batch', { itemIndexes: [1, 2] }));
check('find_price_batch matches 2/2', b1.result?.items?.length === 2 && b1.result.items.every((i: any) => i.product), b1.result);
check('item1 resolves to PVC product', b1.result.items[0]?.product?.id === 'p-pvc', b1.result.items[0]);
check('item2 resolves to Acrylic product', b1.result.items[1]?.product?.id === 'p-acr', b1.result.items[1]);
// 2. single find_price recalls item 1 session (no re-ask data loss)
const f1: any = flat(await exec(ctx, 'find_price', { itemIndex: 1 }));
check('find_price recalls product for item 1', f1.result?.product?.id === 'p-pvc', f1.result);
// 3. ask_specs for the PVC product (distinct product step)
const a1: any = flat(await exec(ctx, 'ask_specs', { productId: 'p-pvc', itemIndex: 1 }));
check('ask_specs returns stepped form', a1.proposals?.[0]?.kind === 'spec_form', a1.proposals?.[0]?.kind);
// 4. batch quote with specs (acrylic has no rates → procurement route)
const q: any = flat(await exec(ctx, 'quote_price_batch', { items: [
  { itemIndex: 1, specs: { thickness: '18mm', size: '8x4 ft' } },
  { itemIndex: 2, specs: { thickness: '5mm', size: '8x4 ft' } },
]}));
check('batch quotes item 1 with marked price', typeof q.result?.items?.[0]?.markedPrice === 'number', q.result?.items?.[0]);
check('batch item 1 price = 1450 + 25% rounded', q.result.items[0].markedPrice === 1815, q.result.items[0]);
check('batch routes item 2 (no rates) to procurement', q.result?.items?.[1]?.routed === 'procurement', q.result?.items?.[1]);
const table = (q.proposals ?? []).find((p: any) => p.kind === 'price_table');
check('batch emits one combined price_table', !!table && table.rows?.length === 1, table);
check('table row carries itemIndex+itemName', table?.rows?.[0]?.itemIndex === 1 && /PVC/i.test(table?.rows?.[0]?.itemName ?? ''), table?.rows?.[0]);
// 5. session persists: quote without specs reuses saved specs
const q2: any = flat(await exec(ctx, 'quote_price_batch', { items: [{ itemIndex: 1 }] }));
check('session reuses saved specs (no re-ask)', typeof q2.result?.items?.[0]?.markedPrice === 'number', q2.result?.items?.[0]);
// 6. invalid item number errors cleanly
const bad: any = flat(await exec(ctx, 'find_price_batch', { itemIndexes: [9] }));
check('out-of-range item errors', /no Item 9/.test(bad.result?.items?.[0]?.error ?? ''), bad.result);
// 7. ask_question renders an answerable card (not prose)
const qq: any = flat(await exec(ctx, 'ask_question', { title: 'Delivery', questions: [
  { key: 'city', label: 'Which city should it be delivered to?', type: 'text' },
  { key: 'urgent', label: 'Is this urgent?', type: 'options', options: ['Yes', 'No'] },
]}));
check('ask_question returns spec_form card', qq.proposals?.[0]?.kind === 'spec_form' && qq.proposals?.[0]?.questions?.length === 2, qq.proposals?.[0]);
check('ask_question card titled', qq.proposals?.[0]?.productName === 'Delivery', qq.proposals?.[0]?.productName);
check('ask_question rejects empty', (flat(await exec(ctx, 'ask_question', { title: 'x', questions: [] })).result as any)?.error === 'no valid questions given', null);
// 7b. MCQ / MSQ / numeric / date types pass through; weak option lists degrade to text
const qt: any = flat(await exec(ctx, 'ask_question', { title: 'Specs', questions: [
  { key: 'm', label: 'Pick materials', type: 'multiselect', options: ['MS', 'SS', 'PP'] },
  { key: 'q', label: 'Quantity', type: 'number' },
  { key: 'd', label: 'Needed by', type: 'date' },
  { key: 'c', label: 'Pick one', type: 'options', options: ['Only'] },
]}));
const qtypes = (qq.proposals?.[0]?.questions ?? []).concat(qt.proposals?.[0]?.questions ?? []).map((x) => x.type);
check('msq/number/date types preserved', JSON.stringify(qt.proposals?.[0]?.questions?.map((x) => x.type)) === JSON.stringify(['multiselect', 'number', 'date', 'text']), qt.proposals?.[0]?.questions?.map((x) => x.type));
void qtypes;
// 8. generic answers never pollute the price session (only checklist keys persist)
await exec(ctx, 'quote_price_batch', { items: [{ itemIndex: 1, specs: { thickness: '18mm', size: '8x4 ft', 'Delivery City': 'Pune', urgent: 'Yes' } }] });
const f2: any = flat(await exec(ctx, 'find_price', { itemIndex: 1 }));
const sessKeys = Object.keys(f2.result?.sessionSpecs ?? {});
check('session keeps checklist specs only', sessKeys.includes('thickness') && sessKeys.includes('size') && !sessKeys.some((k) => /delivery|urgent/i.test(k)), sessKeys);
`);
const out = join(dir, 'bundle.mjs');
const REDIRECTS = {
  '../../automations/product-line/service': join(dir, 'service.mjs'),
  '../../shared/cache': join(dir, 'cache.mjs'),
  './routes': join(dir, 'routes.mjs'),
  '../../copilot/engine': join(dir, 'engine.mjs'),
};
await build({
  entryPoints: [join(dir, 'entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  logLevel: 'error',
  plugins: [{
    name: 'test-redirects',
    setup(b) {
      for (const [from, to] of Object.entries(REDIRECTS)) {
        b.onResolve({ filter: new RegExp('^' + from.replace(/[./]/g, (c) => '\\' + c) + '$') }, () => ({ path: to }));
      }
    },
  }],
});
await import(pathToFileURL(out).href);
