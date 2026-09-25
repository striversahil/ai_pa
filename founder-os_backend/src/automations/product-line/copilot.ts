// automations/product-line/copilot.ts — product-line department copilot.
//
// Read-only Q&A over the Product Line master (products, guide checklists,
// vendors, quotes) on the shared engine (src/copilot). No proposals, no
// writes — the catalogue is edited through the dashboard modals (MIS-gated).
import type { ToolDefinition } from '../../shared/ai-gateway';
import type { CopilotDef } from '../../copilot/types';
import { getProductDetail, getProductLineData } from './service';
import type { ProductLineData, RateRow } from './types';

interface ProductCtx {
  env: Record<string, unknown>;
  me: any;
}

function effectivePrice(r: RateRow): number | null {
  if (r.pricePerUnit == null) return null;
  const d = Number(r.discountPercent ?? 0) || 0;
  return r.pricePerUnit * (1 - d / 100);
}

function rateView(r: RateRow) {
  return {
    vendor: r.vendorName ?? r.vendorId,
    vendorType: r.vendorType ?? '',
    pricePerUnit: r.pricePerUnit,
    effectivePrice: effectivePrice(r),
    unit: r.unit,
    discountPercent: r.discountPercent,
    moq: r.moq,
    deliveryDays: r.deliveryDays,
    weightPerUnit: r.weightPerUnit,
    packageQty: r.packageQty,
    packageDims: r.packageDims,
    specs: r.attrValues ?? {},
    quotedAt: r.quotedAt,
    active: r.active,
  };
}

function matchProduct(data: ProductLineData, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return (data.products ?? []).filter((p) =>
    p.id === q.trim() ||
    p.name.toLowerCase().includes(needle) ||
    p.category.toLowerCase().includes(needle) ||
    (p.aliases ?? []).some((a) => String(a).toLowerCase().includes(needle)),
  );
}

async function execTool(ctx: ProductCtx, name: string, args: Record<string, any>): Promise<{ result: unknown }> {
  if (name === 'search_products') {
    const data = await getProductLineData();
    const found = matchProduct(data, String(args.query ?? '')).slice(0, 8);
    return {
      result: {
        products: found.map((p) => {
          const rates = (data.rates ?? []).filter((r) => r.productId === p.id && r.active && r.pricePerUnit != null);
          const best = rates.length ? Math.min(...rates.map((r) => effectivePrice(r) ?? Infinity)) : null;
          return {
            id: p.id, name: p.name, category: p.category,
            aliases: p.aliases ?? [], active: p.active,
            guideQuestions: p.guideCount, quotes: p.rateCount,
            bestEffectivePrice: best == null || !isFinite(best) ? null : Math.round(best * 100) / 100,
          };
        }),
      },
    };
  }

  if (name === 'get_product_detail') {
    const q = String(args.product ?? '');
    const data = await getProductLineData();
    const hit = matchProduct(data, q)[0];
    if (!hit) return { result: { error: `no product matches "${q.slice(0, 80)}"` } };
    const detail = await getProductDetail(hit.id);
    return {
      result: {
        product: { id: detail.product.id, name: detail.product.name, category: detail.product.category, aliases: detail.product.aliases ?? [] },
        guide: (detail.guide ?? []).filter((g) => g.active).map((g) => ({
          question: g.question, required: g.isRequired, note: g.guideNote,
        })),
        quotes: (detail.rates ?? []).slice(0, 15).map(rateView),
      },
    };
  }

  if (name === 'compare_quotes') {
    const q = String(args.product ?? '');
    const data = await getProductLineData();
    const hit = matchProduct(data, q)[0];
    if (!hit) return { result: { error: `no product matches "${q.slice(0, 80)}"` } };
    const rows = (data.rates ?? [])
      .filter((r) => r.productId === hit.id && r.active && r.pricePerUnit != null)
      .map((r) => ({ ...rateView(r), _eff: effectivePrice(r) ?? Infinity }))
      .sort((a, b) => a._eff - b._eff)
      .slice(0, 10)
      .map(({ _eff, ...r }) => r);
    return { result: { product: hit.name, quotes: rows } };
  }

  if (name === 'vendor_lookup') {
    const needle = String(args.query ?? '').trim().toLowerCase();
    const data = await getProductLineData();
    const found = (data.vendors ?? [])
      .filter((v) => !needle || v.name.toLowerCase().includes(needle) || String(v.location ?? '').toLowerCase().includes(needle))
      .slice(0, 8);
    return {
      result: {
        vendors: found.map((v) => ({
          name: v.name, type: v.vendorType || '', active: v.active,
          contactPerson: v.contactPerson, phone1: v.contactPhone1, phone2: v.contactPhone2,
          location: v.location, yearEstablished: v.yearEstablished,
          quotes: v.rateCount,
        })),
      },
    };
  }

  return { result: { error: `unknown tool ${name}` } };
}

/** Product-line department definition for the shared engine. */
export const productLineCopilotDef: CopilotDef<ProductCtx> = {
  id: 'product-line',
  // Same gate as quote reads: product-line scope, MIS, or admin.
  checkAccess: (me: any) => {
    if (!me) return { status: 401, error: 'Authentication required' };
    if ((me as any).isAdmin) return null;
    const scopes: string[] = (me as any).scopes ?? [];
    if (scopes.includes('product-line') || scopes.includes('mis')) return null;
    return { status: 403, error: "Requires 'product-line' permission" };
  },
  buildCtx: (env, me) => ({ env, me }),
  sessionKey: (ctx) => {
    const who = String(ctx.me?.user?.email ?? ctx.me?.user?.id ?? 'anon').toLowerCase();
    return `copilot:product-line:${who}`;
  },
  historyKey: (ctx) => {
    const who = String(ctx.me?.user?.email ?? ctx.me?.user?.id ?? 'anon').toLowerCase();
    return `copilot:hist:pl:${who}`;
  },
  historyTtlMs: 60 * 60 * 1000,
  historyMaxMsgs: 100,
  countKey: () => 'copilot:count:product-line',
  systemPrompt: () => (
    'You are the product-line staff helper for the BUI catalogue team. Answer questions about the product master, requirement checklists, vendors, and vendor quotes using the tools — never invent products, prices, specs, or vendor details. ' +
    'When comparing vendor quotes, use a markdown table (vendor, effective price, MOQ, delivery). ' +
    'Effective price already accounts for discount. Keep replies short; quote prices exactly as stored (₹, per unit).'
  ),
  toolDefs: () => [
    {
      type: 'function',
      function: {
        name: 'search_products',
        description: 'Find catalogue products by name, alias, or category. Returns id, category, guide question count, quote count, best effective price.',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_product_detail',
        description: 'Full detail for one product: requirement checklist questions plus vendor quotes with specs and prices.',
        parameters: { type: 'object', properties: { product: { type: 'string', description: 'Product id or name' } }, required: ['product'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'compare_quotes',
        description: 'Active vendor quotes for one product sorted by effective price (cheapest first).',
        parameters: { type: 'object', properties: { product: { type: 'string', description: 'Product id or name' } }, required: ['product'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'vendor_lookup',
        description: 'Find vendors by name or location with contact details and quote counts.',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
    },
  ],
  execTool,
  activityLabel: (name, args, out) => {
    const r = (out.result ?? {}) as Record<string, any>;
    switch (name) {
      case 'search_products': {
        const n = Array.isArray(r.products) ? r.products.length : 0;
        return `Searched catalogue · ${n} match${n === 1 ? '' : 'es'}`;
      }
      case 'get_product_detail': {
        const n = Array.isArray(r.quotes) ? r.quotes.length : 0;
        return r.error ? 'Product not found' : `Read ${String((r.product as any)?.name ?? 'product').slice(0, 40)} · ${n} quote${n === 1 ? '' : 's'}`;
      }
      case 'compare_quotes': {
        const n = Array.isArray(r.quotes) ? r.quotes.length : 0;
        return r.error ? 'Product not found' : `Compared ${n} quote${n === 1 ? '' : 's'}`;
      }
      case 'vendor_lookup': {
        const n = Array.isArray(r.vendors) ? r.vendors.length : 0;
        return `Vendor lookup · ${n} match${n === 1 ? '' : 'es'}`;
      }
      default:
        return `Ran ${name}`;
    }
  },
  modelEnvVar: 'COPILOT_MODEL',
  defaultModel: 'agnes-3.0-flash',
  emptyHint: 'I can’t help with that — try asking about a product, vendor, or quote.',
};
