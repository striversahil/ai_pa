// automations/bulk-import/chat.ts — "Bulk" AI-agent tab over staged batches.
//
// Conversational bulk correction + verify + commit-as-block. Runs on the
// shared engine (src/copilot) like knowledge/intake. The open batch arrives
// per request (chat body batchId → buildCtx extra) — never pasted row text
// (chat truncates at 2000 chars; the batch store is the context).
//
// Discipline: summaries through tools (tool results cap ~3000 chars — never
// row dumps); EVERY write goes through a Confirm proposal card (uniform with
// rate_draft); block commit only after bulk_verify + an explicit
// correct/not-correct verdict in prose.
import type { ToolDefinition } from '../../shared/ai-gateway';
import type { CopilotDef, CopilotExecResult } from '../../copilot/types';
import { getProductDetail, getProductIndex, getVendorIndex } from '../product-line/service';
import { commitBatch } from './commit';
import {
  bulkApplySet, getBatch, getBatchRows, listBatches, previewBulkRows,
} from './store';
import type { BulkRowFilter } from './store';

interface BulkCtx {
  env: Record<string, unknown>;
  me: any;
  who: string;
  batchId: string;
}

const OPEN_KEY_TTL_MS = 60 * 60 * 1000;

async function resolveBatchId(ctx: BulkCtx): Promise<string> {
  if (ctx.batchId) return ctx.batchId;
  // Fallback: newest review/parsing batch (single-user root flow).
  const batches = await listBatches(10).catch(() => []);
  const hit = (batches ?? []).find((b: any) => b.status !== 'committed');
  if (hit) return String((hit as any).id);
  throw new Error('no open batch — pick one in the batch picker first');
}

function statusLine(rows: { status: string }[]): string {
  const c: Record<string, number> = {};
  for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
  return Object.entries(c).map(([k, v]) => `${v} ${k}`).join(', ');
}

async function execTool(ctx: BulkCtx, name: string, args: Record<string, any>): Promise<{ result: unknown; proposals?: any[] }> {
  if (name === 'bulk_status') {
    let bid = ctx.batchId;
    if (!bid) {
      const batches = await listBatches(10).catch(() => []);
      return {
        result: {
          openBatch: null,
          batches: (batches ?? []).slice(0, 8).map((b: any) => ({
            id: String(b.id), name: String(b.sourceName ?? ''), kind: String(b.sourceKind ?? ''),
            status: String(b.status ?? ''), ready: Number(b.readyCount ?? 0), total: Number(b.rowCount ?? 0),
          })),
        },
      };
    }
    const batch = await getBatch(bid);
    if (!batch) return { result: { error: 'batch not found — pick another' } };
    const rows = await getBatchRows(bid, undefined, 2000);
    const missHist: Record<string, number> = {};
    for (const r of rows) for (const m of r.missing ?? []) missHist[m] = (missHist[m] ?? 0) + 1;
    const topMissing = Object.entries(missHist).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const products: Record<string, number> = {};
    for (const r of rows) if (r.productId && r.productName) products[r.productName] = (products[r.productName] ?? 0) + 1;
    const topProducts = Object.entries(products).sort((a, b) => b[1] - a[1]).slice(0, 10);
    return {
      result: {
        batch: { id: batch.id, name: batch.sourceName, kind: batch.sourceKind, status: batch.status, quotedAt: batch.quotedAt.slice(0, 10) },
        total: rows.length,
        byStatus: statusLine(rows),
        vendorFilled: rows.filter((r) => r.vendorId || r.vendorName).length,
        topMissing, topProducts,
      },
    };
  }

    if (name === 'bulk_change' || name === 'bulk_link') {
    const bid = await resolveBatchId(ctx).catch((e: any) => null);
    if (!bid) return { result: { error: 'no open batch — pick one first' } };
    if (name === 'bulk_change') {
      // Multi-op: one command can carry several changes at once
      // ("units to mtr AND vendor to X") — one preview, one Confirm card.
      const rawOps = Array.isArray(args.ops) && args.ops.length
        ? (args.ops as Record<string, unknown>[])
        : [{ field: args.field, value: args.value, filter: args.filter }];
      const vendors = await getVendorIndex().catch(() => []);
      const ops: { desc: string; scope: string; filter: BulkRowFilter; patch: Record<string, unknown>; matched: number; sample: string[] }[] = [];
      for (const op of rawOps.slice(0, 8)) {
        const field = String((op as any)?.field ?? '');
        const value = (op as any)?.value;
        const filter: BulkRowFilter = {};
        const f = ((op as any)?.filter ?? {}) as Record<string, unknown>;
        if (f.status) filter.status = String(f.status);
        if (f.productContains) filter.productContains = String(f.productContains);
        if (f.missingContains) filter.missingContains = String(f.missingContains);
        const SCALARS = ['price', 'unit', 'discount', 'moq', 'deliveryDays', 'weightPerUnit', 'packageQty', 'packageDims'];
        const patch: Record<string, unknown> = {};
        let desc = '';
        if (field.startsWith('spec:')) {
          const key = field.slice(5).trim();
          if (!key) return { result: { error: 'spec key needed (spec:<attrKey>)' } };
          if (String(value ?? '').trim() === '') return { result: { error: 'spec value needed' } };
          patch.mergeSpecs = { [key.slice(0, 120)]: String(value).trim().slice(0, 500) };
          desc = `spec ${key} = "${String(value).slice(0, 60)}"`;
        } else if (field === 'vendor') {
          const nm = String(value ?? '').trim();
          if (!nm) return { result: { error: 'vendor name needed' } };
          const hit = (vendors ?? []).find((v: any) => String(v.name ?? '').toLowerCase() === nm.toLowerCase());
          if (hit) { patch.vendorId = String((hit as any).id); patch.vendorName = String((hit as any).name); }
          else { patch.vendorId = null; patch.vendorName = nm.slice(0, 200); }
          desc = `vendor = "${nm.slice(0, 60)}"`;
        } else if (SCALARS.includes(field)) {
          if (value === undefined || value === null || String(value).trim() === '') {
            return { result: { error: `${field} value needed` } };
          }
          (patch as any)[field] = ['price', 'discount', 'deliveryDays', 'weightPerUnit'].includes(field)
            ? Number(value) : String(value).slice(0, 300);
          if (['price', 'discount', 'deliveryDays', 'weightPerUnit'].includes(field) && !Number.isFinite(Number((patch as any)[field]))) {
            return { result: { error: `${field} must be a number` } };
          }
          desc = `${field} = "${String(value).slice(0, 60)}"`;
        } else {
          return { result: { error: `field must be unit/discount/moq/deliveryDays/weightPerUnit/packageQty/packageDims/price/vendor/spec:<key> — got "${field.slice(0, 60)}"` } };
        }
        const prev = await previewBulkRows(bid, filter);
        if (prev.count === 0) return { result: { matched: 0, note: `no rows match "${desc}" — broaden its filter` } };
        const scope = [
          filter.status ? `status ${filter.status}` : null,
          filter.productContains ? `product ~"${filter.productContains.slice(0, 40)}"` : null,
          filter.missingContains ? `missing ~"${filter.missingContains.slice(0, 40)}"` : null,
        ].filter(Boolean).join(' + ') || 'whole batch';
        ops.push({ desc, scope, filter, patch, matched: prev.count, sample: prev.sample.map((r) => `#${r.rowNo} ${r.rawText.slice(0, 80)}`) });
      }
      if (!ops.length) return { result: { error: 'no changes given' } };
      const label = ops.length === 1
        ? `Apply: ${ops[0].desc} on ${ops[0].matched} row${ops[0].matched === 1 ? '' : 's'} (${ops[0].scope})`
        : `Apply ${ops.length} changes at once (${ops.map((o) => o.matched).join('+')} rows)`;
      const text = ops.map((o, i) => `${ops.length > 1 ? `${i + 1}. ` : ''}${o.desc} → ${o.matched} rows (${o.scope})${o.sample.length ? `\n   e.g. ${o.sample[0]}` : ''}`).join('\n');
      return {
        result: { ops: ops.map((o) => ({ change: o.desc, scope: o.scope, matched: o.matched })) },
        proposals: [{
          kind: 'bulk_set_draft', label, text,
          batchId: bid, ops: ops.map((o) => ({ filter: o.filter, patch: o.patch })),
          // legacy single-op shape (older clients / tests)
          filter: ops[0].filter, patch: ops[0].patch,
        }],
      };
    }
  if (name === 'bulk_search_products') {
    const q = String(args.query ?? '').trim();
    if (!q) return { result: { error: 'query needed' } };
    const index = await getProductIndex().catch(() => []);
    const { rankProducts } = await import('../product-line/match');
    const products = (index ?? []).map((p: any) => ({
      id: String(p.id), category: String(p.category ?? ''), name: String(p.name ?? ''),
      aliases: Array.isArray(p.aliases) ? p.aliases : [], active: p.active !== false,
    }));
    const hits = rankProducts(products, q, 8, 1, 0.3).map((x) => ({
      id: x.product.id, name: x.product.name, category: x.product.category, exact: x.exact,
    }));
    return { result: { query: q.slice(0, 120), products: hits } };
  }

  if (name === 'bulk_checklist') {
    const pid = String(args.productId ?? '');
    if (!pid) return { result: { error: 'productId needed' } };
    const detail = await getProductDetail(pid).catch(() => null);
    if (!detail) return { result: { error: 'product not found' } };
    const guide = (((detail as any)?.guide ?? []) as any[])
      .filter((g: any) => g?.active)
      .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((g: any) => ({ key: String(g.attrKey), question: String(g.question).slice(0, 200), required: !!(g?.isRequired) }));
    return { result: { product: String((detail as any)?.product?.name ?? pid), checklist: guide } };
  }

  if (name === 'bulk_link') {
    // bulk_link — resolve rows → product / new draft / alias, as a proposal.
    const matchQ = String(args.match ?? '');
    const rows = await getBatchRows(bid, undefined, 2000);
    // Unprocessed rows are linkable too (raw capture lands unprocessed now).
    let targets = rows.filter((r) => (r.status === 'needs-product' || r.status === 'unprocessed') && !r.productId && !r.isNewProduct);
    if (matchQ) {
      const needle = matchQ.toLowerCase();
      targets = targets.filter((r) => `${r.rawText} ${r.productName ?? ''}`.toLowerCase().includes(needle));
    }
    const rowIds = Array.isArray(args.rowIds) ? args.rowIds.map(String).filter(Boolean) : [];
    if (rowIds.length) {
      const set = new Set(rowIds);
      targets = rows.filter((r) => set.has(r.id));
    }
    if (!targets.length) return { result: { matched: 0, note: 'no linkable rows match — check the match text' } };
    const t = (args.target ?? {}) as Record<string, unknown>;
    if (t.productId) {
      const detail = await getProductDetail(String(t.productId)).catch(() => null);
      if (!detail) return { result: { error: 'product not found' } };
      const pname = String((detail as any)?.product?.name ?? '');
      return {
        result: { matched: targets.length, link: `→ ${pname}` },
        proposals: [{
          kind: 'bulk_link_draft', label: `Link ${targets.length} row${targets.length === 1 ? '' : 's'} → ${pname}`,
          text: targets.slice(0, 5).map((r) => `#${r.rowNo} ${r.rawText.slice(0, 90)}`).join('\n'),
          batchId: bid, rowIds: targets.map((r) => r.id),
          patch: { productId: String(t.productId), productName: pname, ...(t.alias ? { aliasTerm: String(t.alias).slice(0, 120) } : {}) },
        }],
      };
    }
    if ((t as any).newProduct) {
      const np = (t as any).newProduct as Record<string, unknown>;
      const nm = String((np as any)?.name ?? (t as any).name ?? '').trim().slice(0, 200);
      const cat = String((np as any)?.category ?? (t as any).category ?? '').trim();
      if (!nm || !cat) return { result: { error: 'new product needs name + category (live list)' } };
      return {
        result: { matched: targets.length, link: `NEW ${nm} [${cat}]` },
        proposals: [{
          kind: 'bulk_link_draft', label: `Stage ${targets.length} row${targets.length === 1 ? '' : 's'} as NEW ${nm}`,
          text: targets.slice(0, 5).map((r) => `#${r.rowNo} ${r.rawText.slice(0, 90)}`).join('\n'),
          batchId: bid, rowIds: targets.map((r) => r.id),
          patch: { isNewProduct: true, productName: nm, newCategory: cat, productId: null },
        }],
      };
    }
    return { result: { error: 'target needed: {productId} (+alias?) or {newProduct:{name, category}}' } };
  }

  if (name === 'bulk_verify') {
    const bid = await resolveBatchId(ctx).catch(() => null);
    if (!bid) return { result: { error: 'no open batch' } };
    const batch = await getBatch(bid);
    if (!batch) return { result: { error: 'batch not found' } };
    const rows = await getBatchRows(bid, undefined, 2000);
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const blockers: string[] = [];
    const needsProduct = rows.filter((r) => r.status === 'needs-product');
    if (needsProduct.length) blockers.push(`${needsProduct.length} rows without a product: ${needsProduct.slice(0, 5).map((r) => `#${r.rowNo} ${r.rawText.slice(0, 60)}`).join(' · ')}${needsProduct.length > 5 ? ' …' : ''}`);
    const noVendor = rows.filter((r) => !r.vendorId && !r.vendorName && r.status !== 'duplicate');
    if (noVendor.length) blockers.push(`${noVendor.length} rows without a vendor`);
    const noPrice = rows.filter((r) => (r.price == null || !(r.price > 0)) && r.status !== 'duplicate');
    if (noPrice.length) blockers.push(`${noPrice.length} rows without a usable price`);
    // Spec coverage per top product (required questions vs filled).
    const specGaps: string[] = [];
    const byProduct = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!r.productId || r.isNewProduct) continue;
      if (!byProduct.has(r.productId)) byProduct.set(r.productId, []);
      byProduct.get(r.productId)!.push(r);
    }
    for (const [pid, list] of [...byProduct.entries()].slice(0, 8)) {
      try {
        const detail = await getProductDetail(pid).catch(() => null);
        const req = (((detail as any)?.guide ?? []) as any[]).filter((g: any) => g?.active && g?.isRequired);
        if (!req.length) continue;
        const missingKeys = new Set<string>();
        for (const r of list) for (const g of req) {
          if (!String((r.specs ?? {})[String(g.attrKey)] ?? '').trim()) missingKeys.add(String(g.attrKey));
        }
        if (missingKeys.size) specGaps.push(`${list[0]?.productName ?? pid}: ${list.length} rows miss ${[...missingKeys].slice(0, 4).join(', ')}`);
      } catch { /* best-effort */ }
    }
    const dups = rows.filter((r) => r.status === 'duplicate').length;
    const ready = byStatus.ready ?? 0;
    const verdict = blockers.length === 0 && ready > 0 ? 'READY' : ready === 0 ? 'NOT READY' : 'PARTIAL';
    return {
      result: {
        batch: { id: batch.id, name: batch.sourceName, status: batch.status },
        total: rows.length, byStatus, ready, duplicates: dups,
        blockers, specGaps: specGaps.slice(0, 8),
        verdict,
      },
    };
  }

  if (name === 'bulk_propose_block') {
    const bid = await resolveBatchId(ctx).catch(() => null);
    if (!bid) return { result: { error: 'no open batch' } };
    const batch = await getBatch(bid);
    if (!batch) return { result: { error: 'batch not found' } };
    if (batch.status === 'committed') return { result: { error: 'already committed — nothing to propose' } };
    const rows = await getBatchRows(bid, undefined, 2000);
    const ready = rows.filter((r) => r.status === 'ready').length;
    const dups = rows.filter((r) => r.status === 'duplicate').length;
    const rest = rows.length - ready - dups;
    if (ready === 0) return { result: { error: 'zero ready rows — run bulk_verify and fix blockers first' } };
    return {
      result: { ready, duplicatesSkipped: dups, incompleteSkipped: rest },
      proposals: [{
        kind: 'block_draft',
        label: `Commit block: ${ready} rate${ready === 1 ? '' : 's'} (${dups} duplicates + ${rest} incomplete skip)`,
        text: `Batch "${batch.sourceName}": files ${ready} live rates stamped with this block id. ${dups} duplicates and ${rest} incomplete rows skip automatically. Verify said so — confirm to write to the catalogue.`,
        batchId: bid,
      }],
    };
  }

  return { result: { error: `unknown tool ${name}` } };
}

async function executeProposal(ctx: BulkCtx, action: Record<string, any>): Promise<CopilotExecResult> {
  const kind = String(action?.kind ?? '');
  const fail = (error: string, status = 400): CopilotExecResult => ({ result: { status, body: { error } }, applied: 'none' });
  const bid = String(action?.batchId ?? ctx.batchId ?? '');
  if (!bid) return fail('batch missing — pick one first');

  if (kind === 'bulk_set_draft') {
    try {
      // Multi-op proposals carry ops[]; single-op legacy carries filter+patch.
      const opList: { filter: BulkRowFilter; patch: Record<string, unknown> }[] =
        Array.isArray(action?.ops) && action.ops.length
          ? action.ops.map((o: any) => ({ filter: (o?.filter ?? {}) as BulkRowFilter, patch: (o?.patch ?? {}) as Record<string, unknown> }))
          : [{ filter: (action?.filter ?? {}) as BulkRowFilter, patch: (action?.patch ?? {}) as Record<string, unknown> }];
      let updated = 0;
      for (const op of opList.slice(0, 8)) {
        const mergeSpecs = (op.patch as any).mergeSpecs && typeof (op.patch as any).mergeSpecs === 'object'
          ? (op.patch as any).mergeSpecs as Record<string, string> : undefined;
        const { price, unit, discount, moq, deliveryDays, weightPerUnit, packageQty, packageDims, vendorId, vendorName } = op.patch as any;
        const out = await bulkApplySet(bid, op.filter, {
          price: price ?? undefined, unit: unit ?? undefined, discount: discount ?? undefined,
          moq: moq ?? undefined, deliveryDays: deliveryDays ?? undefined,
          weightPerUnit: weightPerUnit ?? undefined, packageQty: packageQty ?? undefined,
          packageDims: packageDims ?? undefined, vendorId: vendorId ?? undefined,
          vendorName: vendorName ?? undefined, mergeSpecs,
        });
        updated += out.updated;
      }
      await cacheDelBulkList().catch(() => {});
      return { result: { status: 200, body: { ok: true, updated, ops: opList.length, live: 'bulk-import' } }, applied: 'bulk_set_draft' };
    } catch (e: any) {
      return fail(String(e?.message ?? 'bulk apply failed').slice(0, 300));
    }
  }

  if (kind === 'bulk_link_draft') {
    try {
      const rowIds = Array.isArray(action?.rowIds) ? action.rowIds.map(String) : [];
      const patch = (action?.patch ?? {}) as Record<string, unknown>;
      if (!rowIds.length) return fail('no rows in proposal');
      const out = await bulkApplySet(bid, { ids: rowIds }, {
        productId: (patch as any)?.productId ?? undefined,
        productName: (patch as any)?.productName ?? undefined,
        isNewProduct: (patch as any)?.isNewProduct ?? undefined,
        newCategory: (patch as any)?.newCategory ?? undefined,
      });
      // Alias flow: append the row wording to the product for next time.
      if ((patch as any)?.productId && (patch as any)?.aliasTerm) {
        try {
          const { updateProduct } = await import('../product-line/update');
          const detail = await getProductDetail(String((patch as any).productId)).catch(() => null);
          const term = String((patch as any).aliasTerm);
          const existing = (((detail as any)?.product as any)?.aliases ?? []) as string[];
          if (detail && term && !existing.map((a) => String(a).toLowerCase()).includes(term.toLowerCase())) {
            await updateProduct(String((patch as any).productId), { aliases: [...existing, term] }).catch(() => {});
          }
        } catch { /* link stands without the alias */ }
      }
      await cacheDelBulkList().catch(() => {});
      return { result: { status: 200, body: { ok: true, updated: out.updated, live: 'bulk-import' } }, applied: 'bulk_link_draft' };
    } catch (e: any) {
      return fail(String(e?.message ?? 'bulk link failed').slice(0, 300));
    }
  }

  if (kind === 'block_draft') {
    try {
      const out = await commitBatch(bid);
      await cacheDelBulkList().catch(() => {});
      return {
        result: {
          status: 200,
          body: {
            ok: true, committed: out.committed,
            skippedDuplicates: out.skippedDuplicates,
            skippedIncomplete: out.skippedIncomplete.length,
            live: 'product-line',
          },
        },
        applied: 'block_draft',
      };
    } catch (e: any) {
      return fail(String(e?.message ?? 'commit failed').slice(0, 300));
    }
  }

  return fail('unknown action');
}

async function cacheDelBulkList(): Promise<void> {
  try {
    const { cacheDel } = await import('../../shared/cache');
    await cacheDel('bulk-import:batches:v1');
  } catch { /* best-effort */ }
}

const TOOL_DEFS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'bulk_status',
      description: 'Batch overview: counts by status, top missing labels, vendor coverage, top products. With no open batch, lists review batches to pick from. Call FIRST every turn.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_change',
      description: 'Preview one-shot bulk change(s) — always returns ONE Confirm proposal covering everything, never applies directly. Single: {field, value, filter}. Multiple at once: {ops: [{field, value, filter}, ...]} (max 8) — use this when the user packs several fixes in one message ("units to mtr and vendor to X"). field: unit/discount/moq/deliveryDays/weightPerUnit/packageQty/packageDims/price/vendor/spec:<attrKey>. filter: {status, productContains, missingContains}.',
      parameters: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          value: { type: 'string' },
          filter: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              productContains: { type: 'string' },
              missingContains: { type: 'string' },
            },
          },
          ops: {
            type: 'array',
            description: 'Multiple changes in one shot (preferred when the message has several)',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                value: { type: 'string' },
                filter: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    productContains: { type: 'string' },
                    missingContains: { type: 'string' },
                  },
                },
              },
              required: ['field', 'value'],
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_link',
      description: 'Link unresolved rows to a product (or stage as NEW / add alias) — returns a Confirm proposal with the exact row list. match: substring over raw text (empty = all unresolved). target: {productId (+alias term?)} or {newProduct:{name, category}}.',
      parameters: {
        type: 'object',
        properties: {
          match: { type: 'string' },
          rowIds: { type: 'array', items: { type: 'string' } },
          target: { type: 'object' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_verify',
      description: 'Correctness report for the open batch: ready %, blockers (product-less/vendor-less/priceless rows), per-product spec gaps, duplicates, READY/PARTIAL/NOT READY verdict. Call before ANY block proposal.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_propose_block',
      description: 'Propose committing the open batch as one traceable block (Confirm card → live rates). Only after bulk_verify and a correct/not-correct verdict in prose. Refuses when zero rows are ready.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

/** Root-only (founder decision: bulk import stays root until v2). */
function rootGate(me: any): { status: number; error: string } | null {
  if (!me) return { status: 401, error: 'Authentication required' };
  if ((me as any).isRoot === true) return null;
  return { status: 403, error: 'Bulk import is root-only for now' };
}

/** Bulk chat department definition for the shared engine. */
export const productLineBulkDef: CopilotDef<BulkCtx> = {
  id: 'product-line-bulk',
  checkAccess: rootGate,
  buildCtx: (env, me, extra) => ({
    env, me,
    who: String(me?.user?.email ?? me?.user?.id ?? 'anon').toLowerCase(),
    batchId: String((extra as any)?.batchId ?? ''),
  }),
  sessionKey: (ctx) => `copilot:bulk:${ctx.who}`,
  historyKey: (ctx) => `copilot:hist:bulk:${ctx.who}`,
  historyTtlMs: 60 * 60 * 1000,
  historyMaxMsgs: 100,
  countKey: () => 'copilot:count:product-line-bulk',
  systemPrompt: () => (
    'You are the bulk price-list operator for the BUI catalogue. One open batch at a time (it arrives with the turn — never ask which batch; if none is open, call bulk_status and help pick one). ' +
    'Every turn: 1) call bulk_status FIRST to see the batch. 2) For bulk corrections ("all units in meters", "set vendor X on..."), call bulk_change — ONE call with ops[] when the message packs several fixes ("units to mtr and vendor to X and discount 0"); it returns a single Confirm proposal covering everything, never applies directly. ' +
    'When the user says "fix everything", first bulk_verify, then bundle every fixable blocker into one bulk_change ops[] call (missing units, vendor, per-product specs you can read from the rows) — only genuinely ambiguous items (which product? which category?) go back as questions. ' +
    '3) For unresolved rows, resolve with bulk_link (link to a catalogue product, add an alias term when the wording is worth keeping, or stage NEW with a live-list category). ' +
    '4) Before ANY block proposal, call bulk_verify and state the verdict in prose: "correct, N ready" or the exact blockers. Only then bulk_propose_block. ' +
    'Rules: every write goes through a Confirm card — no silent writes, ever. Never paste or dump raw rows (tool results are capped). Never invent product ids, categories, or prices. Deletes are NEVER done here — point to the Product Line dashboard Bulk tab. Keep replies short.'
  ),
  toolDefs: () => TOOL_DEFS,
  execTool,
  activityLabel: (name, args, out) => {
    const r = (out.result ?? {}) as Record<string, any>;
    switch (name) {
      case 'bulk_status': return Array.isArray(r.batches) ? `Listed ${r.batches.length} batches` : `Batch status · ${r.total ?? 0} rows`;
      case 'bulk_change': return typeof r.matched === 'number' ? `Change preview · ${r.matched} rows` : 'Change failed';
      case 'bulk_link': return typeof r.matched === 'number' ? `Link preview · ${r.matched} rows` : 'Link failed';
      case 'bulk_verify': return `Verified · ${r.verdict ?? '?'}`;
      case 'bulk_propose_block': return r.error ? 'Block blocked' : `Proposed block · ${r.ready ?? 0} rates`;
      default: return `Ran ${name}`;
    }
  },
  executeProposal,
  modelEnvVar: 'COPILOT_MODEL',
  defaultModel: 'deepseek/deepseek-v4.1-flash',
  emptyHint: 'I can’t help with that — ask for batch status, a bulk change ("set all units to mtr"), or a commit verdict.',
};
