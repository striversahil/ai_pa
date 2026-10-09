// chat-tools-pricing.ts — sales copilot catalogue-price tool implementations.
//
// Verbatim extract from chat.ts execTool (Phase-1 split): the price-lookup
// family (find/ask/question/quote/lookup/batch/list) plus the live-catalogue
// adapters they share. Read/propose tools live in chat-tools.ts; the
// dispatcher routes by name. One concern per file: everything here prices.
import { getProductDetail, getProductIndex, getRatesForProduct } from '../../automations/product-line/service';
import {
  MIN_QUOTE_CONFIDENCE, applyMarkup, effectivePrice, rankProducts, requiredChecklist, resolveProduct,
  salesSafeQuote, scoreRates,
  type MatchGuideRow, type MatchProduct, type MatchRate, type SalesQuote,
} from '../../automations/product-line/match';
import type { ChatProposal, PriceItemState, PriceSession, PriceTableRow, SalesCtx, SpecQuestion } from './chat-types';
import {
  dropVagueSpecs, filterChecklistSpecs, getItemState, itemIdx,
  loadPriceSession, priceWho, resolveSpecKeys, savePriceSession,
} from './chat-prices';

export interface ToolOut {
  result: unknown;
  proposals?: ChatProposal[];
}

/** Live catalogue rows adapted for match.ts (slim cached index — no full-table load). */
async function liveProducts(): Promise<MatchProduct[]> {
  const rows = await getProductIndex().catch(() => []);
  return rows.map((p) => ({
    id: String(p.id),
    category: String(p.category ?? ''),
    name: String(p.name ?? ''),
    aliases: Array.isArray(p.aliases) ? p.aliases.map((s: any) => String(s)) : [],
    active: p.active !== false,
  }));
}
async function liveGuide(productId: string): Promise<MatchGuideRow[]> {
  const detail = await getProductDetail(String(productId)).catch(() => null);
  const rows = (((detail as any)?.guide ?? []) as any[]);
  return rows
    .filter((g: any) => g && g.active !== false && g.active !== 0)
    .map((g: any) => ({
      attrKey: String(g.attrKey ?? ''),
      question: String(g.question ?? ''),
      guideNote: g.guideNote != null ? String(g.guideNote) : null,
      sortOrder: Number(g.sortOrder ?? 0),
      isRequired: g.isRequired === true || g.isRequired === 1,
      active: true,
    }));
}
async function liveRates(productId: string): Promise<MatchRate[]> {
  const rows = await getRatesForProduct(String(productId)).catch(() => []);
  return rows.map((r: any) => ({
    id: String(r.id),
    productId: String(r.productId ?? ''),
    attrValues: (r.attrValues && typeof r.attrValues === 'object' ? r.attrValues : {}) as Record<string, string>,
    pricePerUnit: r.pricePerUnit != null ? Number(r.pricePerUnit) : null,
    unit: String(r.unit ?? ''),
    discountPercent: r.discountPercent != null ? Number(r.discountPercent) : null,
    moq: r.moq != null ? String(r.moq) : null,
    deliveryDays: r.deliveryDays != null ? Number(r.deliveryDays) : null,
    imageUrl: (r as any)?.imageUrl ? String((r as any).imageUrl) : null,
    quotedAt: String(r.quotedAt ?? ''),
    active: r.active !== false,
  }));
}
/** Answer options mined from distinct past rate values (most-used first). */
function specOptions(rates: MatchRate[], key: string): string[] {
  const counts = new Map<string, number>();
  for (const r of rates) {
    const v = String((r.attrValues ?? {})[key] ?? '').trim().slice(0, 120);
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v]) => v);
}
/** Item's own photo urls (image-type media only) for the per-item view. */
function itemPhotos(it: any): string[] {
  const out: string[] = [];
  for (const m of (Array.isArray(it?.media) ? it.media : [])) {
    if ((m as any)?.type === 'image' && (m as any)?.url && out.length < 6) out.push(String((m as any).url));
  }
  return out;
}
/** One vendor-blind table row from a scored catalogue rate — shared by
 *  quote_price, quote_price_batch and list_enquiry_rates, so every table
 *  carries the same full-spec + photo payload for the per-item view. */
function catalogueRow(
  product: MatchProduct,
  guide: MatchGuideRow[],
  s: { rate: MatchRate; confidence: number },
  specs: Record<string, string>,
  required: MatchGuideRow[],
  i: number,
  extra?: { itemIndex?: number; itemName?: string; tag?: string; maxBits?: number; best?: boolean },
): PriceTableRow {
  const q = salesSafeQuote(product, s as any, specs, required, guide);
  const bits = Object.entries(s.rate.attrValues ?? {})
    .map(([, v]) => String(v ?? '').trim())
    .filter(Boolean)
    .filter((v, vi, arr) => arr.indexOf(v) === vi)
    .slice(0, extra?.maxBits ?? 4);
  // BEST is earned, not positional: only a row at/above apply-confidence
  // gets the badge — a low-confidence first row must never claim it.
  const best = extra?.best ?? (i === 0 && s.confidence >= MIN_QUOTE_CONFIDENCE);
  return {
    variation: bits.length > 0 ? bits.join(' · ').slice(0, 140) : `Quote ${i + 1}`,
    markedPrice: q.markedPrice,
    unit: q.unit,
    confidence: q.confidence,
    quoteAgeDays: q.quoteAgeDays,
    moq: q.moq,
    deliveryDays: q.deliveryDays,
    rateId: String(s.rate.id ?? ''),
    best,
    ...(extra?.itemIndex != null ? { itemIndex: extra.itemIndex } : {}),
    ...(extra?.itemName ? { itemName: extra.itemName } : {}),
    ...(extra?.tag ? { tag: extra.tag } : {}),
    specs: q.allSpecs.map((a) => ({ question: a.question, value: a.value || '—' })),
    imageUrl: q.imageUrl,
  };
}

export async function execFindPrice(ctx: SalesCtx, _view: any, enquiry: any, args: Record<string, any>): Promise<ToolOut> {
  if (ctx.restricted) return { result: { error: 'not permitted' } };
  const items = Array.isArray(enquiry.items) ? enquiry.items : [];
  const parsed = itemIdx(args, items.length);
  if ('error' in parsed) return { result: { error: parsed.error } };
  const idx = parsed.idx;
  const it = items[idx];
  if (!it) return { result: { error: `no Item ${parsed.num}` } };
  const kypItem = String((it as any)?.kypItem ?? '').slice(0, 120);
  const category = String((it as any)?.category ?? 'Uncategorized').slice(0, 120);
  const products = await liveProducts();
  // User-picked productId (from a previous candidates list) skips matching.
  const pickedId = String(args.productId ?? '').trim();
  const picked = pickedId ? products.find((p) => p.id === pickedId && p.active !== false) : null;
  if (pickedId && !picked) return { result: { error: 'unknown productId — ask the user to pick from the candidates list again' } };
  const resolved = picked
    ? { product: picked, exact: true }
    : resolveProduct(products, kypItem || String((it as any)?.name ?? ''), category);
  if (!resolved) {
    // Candidate fallback (mirrors intake): loose-bar top hits for the model
    // to offer the user — full catalogue never enters the prompt (20K-safe).
    // Loose here is safe: quoting still needs user pick + specs + the
    // confidence gate. Deterministic tiers miss typos/spec-only lines;
    // those still route out.
    const cands = rankProducts(products, `${kypItem} ${String((it as any)?.name ?? '')} ${category}`, 5, 1, 0.2)
      .map((c) => ({ id: c.product.id, name: c.product.name, category: c.product.category }));
    if (cands.length > 0) {
      return {
        result: {
          error: 'no confident catalogue match', kypItem, category,
          candidates: cands,
          hint: 'offer these candidates to the user to pick one, then call find_price again with the picked productId — or route to procurement if none fit',
        },
      };
    }
    return { result: { error: 'no catalogue match', kypItem, category, hint: 'tell the user this item is routed to procurement' } };
  }
  const required = requiredChecklist(await liveGuide(resolved.product.id));
  // Price session (per-item map): same item+product → keep collected specs; else reset.
  const who = priceWho(ctx.me);
  const prev = await loadPriceSession(ctx.enquiryId, who);
  const prevSt = getItemState(prev, idx);
  const kept = prevSt.productId === resolved.product.id ? prevSt.specs : {};
  const session: PriceSession = {
    items: { ...(prev.items ?? {}), [String(idx)]: { productId: resolved.product.id, productName: resolved.product.name, specs: kept } },
    activeItem: idx,
  };
  await savePriceSession(ctx.enquiryId, who, session);
  // FULL vendor-blind rate list (no top-N cut): the model ranks these
  // against the client's verbatim wording, which deterministic scoring
  // alone can misread. No vendor fields anywhere by design.
  const allRates = (await liveRates(resolved.product.id))
    .filter((r) => r.active !== false && effectivePrice(r.pricePerUnit, r.discountPercent) != null)
    .map((r) => {
      const eff = effectivePrice(r.pricePerUnit, r.discountPercent) ?? 0;
      return {
        specs: { ...(r.attrValues ?? {}) },
        markedPrice: applyMarkup(eff),
        unit: String(r.unit ?? ''),
        moq: r.moq,
        deliveryDays: r.deliveryDays,
        quotedAt: String(r.quotedAt ?? ''),
        imageUrl: (r as any)?.imageUrl ?? null,
      };
    });
  return {
    result: {
      itemIndex: parsed.num,
      product: { id: resolved.product.id, name: resolved.product.name, category: resolved.product.category, exact: resolved.exact },
      required: required.map((g) => ({ key: g.attrKey, question: g.question, note: g.guideNote ?? '' })),
      itemSpec: String((it as any)?.spec ?? '').slice(0, 800),
      intakeMissing: Array.isArray((it as any)?.kypMissing) ? (it as any).kypMissing.slice(0, 10) : [],
      sessionSpecs: kept,
      rates: allRates,
      rateCount: allRates.length,
    },
  };
}

export async function execAskSpecs(ctx: SalesCtx, _view: any, _enquiry: any, args: Record<string, any>): Promise<ToolOut> {
  if (ctx.restricted) return { result: { error: 'not permitted' } };
  const pid = String(args.productId ?? '').trim();
  if (!pid) return { result: { error: 'missing productId' } };
  const product = (await liveProducts()).find((p) => p.id === pid);
  if (!product) return { result: { error: 'unknown product' } };
  const required = requiredChecklist(await liveGuide(pid));
  // Merge session specs (prior turns) with freshly passed knownSpecs.
  // ask_specs is per-product: merge across every session item on this product.
  const who = priceWho(ctx.me);
  const prev = await loadPriceSession(ctx.enquiryId, who);
  const sessionSpecs: Record<string, unknown> = {};
  for (const st of Object.values(prev.items ?? {})) {
    if ((st as PriceItemState)?.productId === pid) Object.assign(sessionSpecs, (st as PriceItemState).specs ?? {});
  }
  const knownRaw = { ...sessionSpecs, ...((args.knownSpecs && typeof args.knownSpecs === 'object' ? args.knownSpecs : {}) as Record<string, unknown>) };
  const known = filterChecklistSpecs(resolveSpecKeys(knownRaw as Record<string, string>, required.map((g) => ({ attrKey: g.attrKey, question: g.question }))), required);
  // Write merged known-specs back to every session item on this product.
  const nextItems: Record<string, PriceItemState> = { ...(prev.items ?? {}) };
  let touchedItem = false;
  for (const [k, st] of Object.entries(nextItems)) {
    if ((st as PriceItemState)?.productId === pid) {
      nextItems[k] = { ...(st as PriceItemState), specs: { ...((st as PriceItemState).specs ?? {}), ...known } };
      touchedItem = true;
    }
  }
  if (!touchedItem && prev.activeItem !== undefined) {
    const cur = getItemState(prev, prev.activeItem);
    nextItems[String(prev.activeItem)] = { productId: pid, productName: product.name, specs: { ...cur.specs, ...known } };
  }
  await savePriceSession(ctx.enquiryId, who, { items: nextItems, activeItem: prev.activeItem });
  const rates = await liveRates(pid);
  const questions: SpecQuestion[] = [];
  for (const g of required) {
    if (String((known as any)[g.attrKey] ?? '').trim()) continue;
    const options = specOptions(rates, g.attrKey);
    questions.push({
      key: g.attrKey,
      label: g.question,
      note: g.guideNote ?? '',
      // Details are OPTIONAL (founder order): every question skippable,
      // and quote_price may be called any time — it quotes with caveats.
      required: false,
      type: options.length >= 2 ? 'options' : 'text',
      options,
    });
  }
  if (questions.length === 0) return { result: { proposed: false, note: 'all required specs already known — call quote_price' } };
  const proposal: ChatProposal = {
    kind: 'spec_form', productId: pid, productName: product.name,
    questions, label: `Specs needed · ${product.name} (${questions.length})`,
  };
  return { result: { proposed: true, questions: questions.length }, proposals: [proposal] };
}

export async function execAskQuestion(_ctx: SalesCtx, _view: any, _enquiry: any, args: Record<string, any>): Promise<ToolOut> {
  const title = String(args.title ?? 'Quick question').slice(0, 120) || 'Quick question';
  const rawQ = Array.isArray(args.questions) ? args.questions : [];
  const questions: SpecQuestion[] = [];
  for (const q of rawQ.slice(0, 6)) {
    const label = String((q as any)?.label ?? '').trim().slice(0, 300);
    if (!label) continue;
    const opts = Array.isArray((q as any)?.options) ? (q as any).options.map((o: any) => String(o ?? '').trim()).filter(Boolean).slice(0, 8) : [];
    const want = String((q as any)?.type ?? 'text');
    // MCQ needs 2+ options, MSQ needs 2+ options — anything else degrades
    // to a text answer box rather than erroring.
    const type = (want === 'options' || want === 'multiselect') && opts.length >= 2
      ? (want as 'options' | 'multiselect')
      : want === 'number' ? 'number'
      : want === 'date' ? 'date'
      : 'text';
    questions.push({
      key: String((q as any)?.key ?? label).slice(0, 80),
      label,
      note: '',
      required: (q as any)?.required !== false,
      type,
      options: opts,
    });
  }
  if (questions.length === 0) return { result: { error: 'no valid questions given' } };
  const proposal: ChatProposal = { kind: 'spec_form', questions, productName: title, label: `${title} (${questions.length})` };
  return { result: { asked: true, questions: questions.length }, proposals: [proposal] };
}

export async function execQuotePrice(ctx: SalesCtx, _view: any, enquiry: any, args: Record<string, any>): Promise<ToolOut> {
  if (ctx.restricted) return { result: { error: 'not permitted' } };
  const pid = String(args.productId ?? '').trim();
  const itemsQ = Array.isArray(enquiry.items) ? enquiry.items : [];
  const parsedQ = itemIdx(args, itemsQ.length);
  if ('error' in parsedQ) return { result: { error: parsedQ.error } };
  const idx = parsedQ.idx;
  const product = (await liveProducts()).find((p) => p.id === pid);
  if (!product) return { result: { error: 'unknown product' } };
  const guide = await liveGuide(pid);
  const required = requiredChecklist(guide);
  // Merge order: session (prior turns) < explicit args (this turn wins).
  // Question-labeled answers (from the spec form) resolve to attrKeys.
  const who = priceWho(ctx.me);
  const prev = await loadPriceSession(ctx.enquiryId, who);
  const prevSt = getItemState(prev, idx);
  const specsIn = (args.specs && typeof args.specs === 'object' ? args.specs : {}) as Record<string, unknown>;
  const merged = filterChecklistSpecs(resolveSpecKeys(
    { ...((prevSt.productId === pid ? prevSt.specs : {}) as Record<string, string>), ...(specsIn as Record<string, string>) },
    required.map((g) => ({ attrKey: g.attrKey, question: g.question })),
  ), required);
  const specs: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) {
    const s = String(v ?? '').trim().slice(0, 200);
    if (s) specs[String(k)] = s;
  }
  const skipSpecs = (args as any)?.skipSpecs === true;
  // Vague words are not specs — drop + flag for targeted questions.
  const dv = dropVagueSpecs(specs, required);
  for (const k of Object.keys(specs)) if (!(k in dv.clean)) delete specs[k];
  // GUIDE-FIRST gate (founder order): nothing usable collected and the
  // product asks questions → don't quote; ask first. skipSpecs ("quote
  // with what we have") bypasses explicitly.
  if (!skipSpecs && Object.keys(specs).length === 0 && required.length > 0) {
    return {
      result: {
        needSpecs: true, productId: pid, productName: product.name,
        vague: dv.vague, hasUsablePrices: false,
        hint: 'no usable specs collected — call ask_specs (options auto-mined from past quotes) or ask_question for the vague ones, then quote_price. Never re-call quote_price with empty specs.',
      },
    };
  }
  await savePriceSession(ctx.enquiryId, who, {
    items: { ...(prev.items ?? {}), [String(idx)]: { productId: pid, productName: product.name, specs } },
    activeItem: idx,
  });
  const scored = scoreRates(await liveRates(pid), pid, specs, required);
  if (scored.length === 0) {
    return {
      result: { error: 'no past rates for this product', routed: 'procurement', hasUsablePrices: false },
      proposals: [{
        kind: 'price_table', itemIndex: idx,
        productId: product.id, productName: product.name,
        rows: [], label: `Past prices · ${product.name} (none found)`,
        text: 'No past prices found for this product.',
        itemMedia: itemPhotos(itemsQ[idx]),
        needsProcurement: true,
      }],
    };
  }
  const best = scored[0];
  // Full variation table (NO top-N cut): every scored past rate as a
  // vendor-blind row — the model + user rank from the whole list.
  const rows: PriceTableRow[] = scored.map((s, i) =>
    catalogueRow(product, guide, s, specs, required, i, { itemIndex: parsedQ.num }));
  const proposals: ChatProposal[] = [{
    kind: 'price_table', itemIndex: idx,
    productId: product.id, productName: product.name,
    rows, label: `Past prices · ${product.name} (${rows.length})`,
    itemMedia: itemPhotos(itemsQ[idx]),
    needsProcurement: false,
  }];
  // Details are OPTIONAL (founder order): below-confidence still quotes —
  // flagged with caveats instead of routing to procurement.
  const quote: SalesQuote = salesSafeQuote(product, best, specs, required, guide);
  const caveated = best.confidence < MIN_QUOTE_CONFIDENCE;
  const caveatNote = caveated && quote.missingSpecs.length > 0
    ? ` — note: ${quote.missingSpecs.map((m) => m.question).join(', ')} not confirmed; closest past match — fetch from procurement if it doesn't work`
    : caveated ? ' — closest past match, lower confidence — fetch from procurement if it doesn\'t work' : '';
  const items = Array.isArray(enquiry.items) ? enquiry.items : [];
  const existing = String((items[idx] as any)?.spec ?? '');
  // Companion spec update: append only genuinely new "Question: value" lines.
  const fresh = quote.matchedSpecs
    .map((m) => `${m.question}: ${m.value}`)
    .filter((line) => line && !existing.toLowerCase().includes(line.toLowerCase().slice(0, 60)));
  proposals.push({
    kind: 'price_quote', itemIndex: idx,
    productId: product.id, productName: product.name,
    markedPrice: quote.markedPrice, unit: quote.unit, confidence: quote.confidence,
    quoteAgeDays: quote.quoteAgeDays, moq: quote.moq, deliveryDays: quote.deliveryDays,
    text: `${product.name} @ ₹${quote.markedPrice}${quote.unit ? `/${quote.unit}` : ''} — confidence ${quote.confidence}, quote ~${quote.quoteAgeDays ?? '?'}d old${quote.moq ? `, MOQ ${quote.moq}` : ''}${quote.deliveryDays != null ? `, ${quote.deliveryDays}d delivery` : ''}${caveatNote}`,
    label: caveated ? `Apply AI price · ${product.name} (closest match)` : `Apply AI price · ${product.name}`,
  });
  if (fresh.length > 0) {
    proposals.push({
      kind: 'spec_fix', itemIndex: idx,
      spec: `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${fresh.join('\n')}`.slice(0, 2000),
      label: `Update Item ${idx + 1} spec with confirmed details`,
    });
  }
  return { result: { proposed: true, caveated, hasUsablePrices: true, ...(dv.vague.length ? { vague: dv.vague } : {}), ...quote }, proposals };
}

export async function execLookupPrice(ctx: SalesCtx, _view: any, _enquiry: any, args: Record<string, any>): Promise<ToolOut> {
  // Catalogue-wide rate lookup with NO enquiry item: the user just wants
  // to know the rate of something. View-only by design (no itemIndex →
  // no Apply column, no procurement button in the UI).
  if (ctx.restricted) return { result: { error: 'not permitted' } };
  const q = String((args as any)?.query ?? (args as any)?.productName ?? '').trim().slice(0, 200);
  const products = await liveProducts();
  const pickedId = String(args.productId ?? '').trim();
  const picked = pickedId ? products.find((p) => p.id === pickedId && p.active !== false) : null;
  if (pickedId && !picked) return { result: { error: 'unknown productId — ask the user to pick from the candidates list again' } };
  const resolved = picked ? { product: picked, exact: true } : (q ? resolveProduct(products, q, '') : null);
  if (!resolved) {
    const cands = q
      ? rankProducts(products, q, 5, 1, 0.2).map((c) => ({ id: c.product.id, name: c.product.name, category: c.product.category }))
      : [];
    if (cands.length > 0) {
      return {
        result: {
          error: 'no confident catalogue match', candidates: cands,
          hint: 'offer these candidates to the user to pick one, then call lookup_price again with the picked productId',
        },
      };
    }
    return { result: { error: q ? 'no catalogue match for that product' : 'tell me which product you want the rate of', hasUsablePrices: false } };
  }
  const product = resolved.product;
  const guide = await liveGuide(product.id);
  const required = requiredChecklist(guide);
  const specsIn = (args.specs && typeof args.specs === 'object' ? args.specs : {}) as Record<string, unknown>;
  const merged = filterChecklistSpecs(resolveSpecKeys(
    specsIn as Record<string, string>,
    guide.map((g) => ({ attrKey: g.attrKey, question: g.question })),
  ), guide);
  const specs: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) {
    const s = String(v ?? '').trim().slice(0, 200);
    if (s) specs[String(k)] = s;
  }
  const scored = scoreRates(await liveRates(product.id), product.id, specs, required);
  if (scored.length === 0) return { result: { error: 'no past rates for this product', hasUsablePrices: false } };
  const best = scored[0];
  const rows: PriceTableRow[] = scored.map((s, i) =>
    catalogueRow(product, guide, s, specs, required, i, { tag: 'Catalogue' }));
  const quote: SalesQuote = salesSafeQuote(product, best, specs, required, guide);
  const caveated = best.confidence < MIN_QUOTE_CONFIDENCE;
  const caveatBits = caveated && quote.missingSpecs.length > 0
    ? ` — note: ${quote.missingSpecs.map((m) => m.question).join(', ')} not confirmed, closest past match`
    : '';
  return {
    result: {
      proposed: true, caveated, hasUsablePrices: true,
      productId: product.id, productName: product.name,
      markedPrice: quote.markedPrice, unit: quote.unit, confidence: quote.confidence,
      note: 'view-only catalogue rate (no enquiry item) — no apply, no procurement',
    },
    proposals: [{
      kind: 'price_table',
      productId: product.id, productName: product.name,
      rows, label: `Catalogue prices · ${product.name} (${rows.length})`,
      text: `${product.name} around ₹${quote.markedPrice}${quote.unit ? `/${quote.unit}` : ''} (confidence ${quote.confidence}${caveatBits}). Not on this enquiry — view only.`,
      needsProcurement: false,
    }],
  };
}

export async function execFindPriceBatch(ctx: SalesCtx, _view: any, enquiry: any, args: Record<string, any>): Promise<ToolOut> {
  if (ctx.restricted) return { result: { error: 'not permitted' } };
  const rawList = Array.isArray(args.itemIndexes) ? args.itemIndexes : [];
  const nums = [...new Set(rawList.map((n: any) => Math.floor(Number(n) || 0)).filter((n: number) => n >= 1))].slice(0, 20);
  if (nums.length === 0) return { result: { error: 'no valid item numbers — use Item 1–N as shown in the chat' } };
  const allItems = Array.isArray(enquiry.items) ? enquiry.items : [];
  const products = await liveProducts();
  const who = priceWho(ctx.me);
  const prev = await loadPriceSession(ctx.enquiryId, who);
  const nextItems: Record<string, PriceItemState> = { ...(prev.items ?? {}) };
  const out: any[] = [];
  for (const num of nums) {
    if (num > allItems.length) {
      out.push({ itemIndex: num, error: `no Item ${num} — this enquiry has ${allItems.length} item${allItems.length === 1 ? '' : 's'}` });
      continue;
    }
    const idx = num - 1;
    const it = allItems[idx];
    const kypItem = String((it as any)?.kypItem ?? '').slice(0, 120);
    const category = String((it as any)?.category ?? 'Uncategorized').slice(0, 120);
    const resolved = resolveProduct(products, kypItem || String((it as any)?.name ?? ''), category);
    if (!resolved) {
      const cands = rankProducts(products, `${kypItem} ${String((it as any)?.name ?? '')} ${category}`, 3, 1, 0.2)
        .map((c) => ({ id: c.product.id, name: c.product.name }));
      out.push({ itemIndex: num, error: 'no confident catalogue match', candidates: cands });
      continue;
    }
    const required = requiredChecklist(await liveGuide(resolved.product.id));
    const prevSt = getItemState(prev, idx);
    const kept = prevSt.productId === resolved.product.id ? prevSt.specs : {};
    nextItems[String(idx)] = { productId: resolved.product.id, productName: resolved.product.name, specs: kept };
    const knownCount = Object.keys(kept).length;
    out.push({
      itemIndex: num,
      product: { id: resolved.product.id, name: resolved.product.name, category: resolved.product.category, exact: resolved.exact },
      requiredSpecs: required.length,
      knownSpecs: knownCount,
    });
  }
  await savePriceSession(ctx.enquiryId, who, { items: nextItems, activeItem: nums.length ? nums[nums.length - 1] - 1 : prev.activeItem });
  return { result: { items: out } };
}

export async function execListEnquiryRates(ctx: SalesCtx, _view: any, enquiry: any, args: Record<string, any>): Promise<ToolOut> {
  if (ctx.restricted) return { result: { error: 'not permitted' } };
  const itemsAll = Array.isArray(enquiry.items) ? enquiry.items : [];
  const parsed = itemIdx(args, itemsAll.length);
  if ('error' in parsed) return { result: { error: parsed.error } };
  const idx = parsed.idx;
  const it = itemsAll[idx] as any;
  const itemName = String(it?.name ?? `Item ${parsed.num}`).slice(0, 80);
  // Vendor-blind by construction: vendor names are dropped, only the
  // numbers + vendor-neutral notes surface (mirrors salesSafeQuote).
  const rows: PriceTableRow[] = ((it?.rates ?? []) as any[]).map((r, i) => {
    const bits: string[] = [];
    const desc = String(r?.description ?? '').trim();
    if (desc) bits.push(desc.slice(0, 120));
    if (r?.specSame === false && String(r?.specDiff ?? '').trim()) {
      bits.push(`Spec: ${String(r.specDiff).trim().slice(0, 100)}`);
    }
    const refs = (Array.isArray(r?.references) ? r.references : [])
      .filter((m: any) => m?.type === 'image' && m?.url)
      .map((m: any) => String(m.url)).slice(0, 3);
    const t = new Date(String(r?.quotedAt ?? '')).getTime();
    return {
      variation: bits.length > 0 ? bits.join(' · ').slice(0, 140) : `Earlier quote ${i + 1}`,
      markedPrice: Number(r?.rate) || 0,
      unit: '',
      confidence: null,
      quoteAgeDays: isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 86_400_000)),
      moq: null,
      deliveryDays: null,
      best: false,
      itemIndex: parsed.num,
      itemName,
      tag: 'Earlier',
      specs: [
        ...(r?.specSame === false && String(r?.specDiff ?? '').trim()
          ? [{ question: 'Their spec', value: String(r.specDiff).trim().slice(0, 200) }] : []),
        ...((r?.sharedWithSales && String(r?.salesNote ?? '').trim())
          ? [{ question: 'Note', value: String(r.salesNote).trim().slice(0, 200) }] : []),
      ],
      imageUrl: refs[0] ?? null,
    };
  }).filter((r) => r.markedPrice > 0);
  const expected = it?.expectedRate != null ? Number(it.expectedRate) : null;
  return {
    result: {
      itemIndex: parsed.num, prices: rows.length,
      expectedRate: Number.isFinite(expected) ? expected : null,
      finalRate: it?.finalRate ?? null, hasUsablePrices: rows.length > 0,
    },
    proposals: [{
      kind: 'price_table', itemIndex: idx,
      productName: itemName,
      rows, label: `Earlier prices · Item ${parsed.num} ${itemName} (${rows.length})`,
      text: rows.length > 0
        ? `On this item so far${Number.isFinite(expected) && (expected as number) > 0 ? ` — expected ₹${expected}` : ''}${it?.finalRate != null ? `, final ₹${it.finalRate}` : ''}.`
        : 'No earlier prices on this item yet.',
      itemMedia: itemPhotos(it),
      needsProcurement: rows.length === 0,
    }],
  };
}

export async function execQuotePriceBatch(ctx: SalesCtx, _view: any, enquiry: any, args: Record<string, any>): Promise<ToolOut> {
  if (ctx.restricted) return { result: { error: 'not permitted' } };
  const rawList = Array.isArray(args.items) ? args.items : [];
  if (rawList.length === 0) return { result: { error: 'no items given' } };
  const allItems = Array.isArray(enquiry.items) ? enquiry.items : [];
  const products = await liveProducts();
  const who = priceWho(ctx.me);
  const prev = await loadPriceSession(ctx.enquiryId, who);
  const nextItems: Record<string, PriceItemState> = { ...(prev.items ?? {}) };
  const out: any[] = [];
  const rows: PriceTableRow[] = [];
  const unpriced: ChatProposal[] = [];
  for (const entry of rawList.slice(0, 20)) {
    const num = Math.floor(Number((entry as any)?.itemIndex) || 0);
    if (!(num >= 1) || num > allItems.length) {
      out.push({ itemIndex: num || 0, error: `no Item ${num} — use Item 1–${allItems.length}` });
      continue;
    }
    const idx = num - 1;
    const st = getItemState({ items: nextItems, activeItem: prev.activeItem }, idx);
    const product = products.find((p) => p.id === st.productId && p.active !== false);
    if (!product) {
      out.push({ itemIndex: num, routed: 'procurement', hasUsablePrices: false, note: 'no resolved product — run find_price_batch first' });
      unpriced.push({
        kind: 'price_table', itemIndex: idx,
        rows: [], label: `Past prices · Item ${num} (no product matched)`,
        text: 'No catalogue product matched — fetch from procurement.',
        itemMedia: itemPhotos(allItems[idx]),
        needsProcurement: true,
      });
      continue;
    }
    const guide = await liveGuide(product.id);
    const required = requiredChecklist(guide);
    const entrySpecs = ((entry as any)?.specs && typeof (entry as any).specs === 'object' ? (entry as any).specs : {}) as Record<string, unknown>;
    const merged = filterChecklistSpecs(resolveSpecKeys(
      { ...(st.specs ?? {}), ...(entrySpecs as Record<string, string>) },
      required.map((g) => ({ attrKey: g.attrKey, question: g.question })),
    ), required);
    const specs: Record<string, string> = {};
    for (const [k, v] of Object.entries(merged)) {
      const s = String(v ?? '').trim().slice(0, 200);
      if (s) specs[String(k)] = s;
    }
    const skipAll = (args as any)?.skipSpecs === true;
    const bv = dropVagueSpecs(specs, required);
    for (const k of Object.keys(specs)) if (!(k in bv.clean)) delete specs[k];
    // GUIDE-FIRST gate per item: nothing usable → ask first, not quote.
    if (!skipAll && Object.keys(specs).length === 0 && required.length > 0) {
      out.push({
        itemIndex: num, product: product.name, needSpecs: true, hasUsablePrices: false,
        vague: bv.vague, note: 'no usable specs — ask first via ask_specs/ask_question, then quote',
      });
      continue;
    }
    nextItems[String(idx)] = { productId: product.id, productName: product.name, specs };
    const scored = scoreRates(await liveRates(product.id), product.id, specs, required);
    const itemName = String((allItems[idx] as any)?.name ?? `Item ${num}`).slice(0, 80);
    if (scored.length === 0) {
      out.push({ itemIndex: num, product: product.name, routed: 'procurement', hasUsablePrices: false, note: 'no past rates for this product' });
      unpriced.push({
        kind: 'price_table', itemIndex: idx,
        productId: product.id, productName: product.name,
        rows: [], label: `Past prices · Item ${num} ${itemName} (none found)`,
        text: 'No past prices found for this product.',
        itemMedia: itemPhotos(allItems[idx]),
        needsProcurement: true,
      });
      continue;
    }
    // Details are OPTIONAL: below-confidence still quotes with caveats.
    const best = scored[0];
    const quote = salesSafeQuote(product, best, specs, required, guide);
    const caveated = best.confidence < MIN_QUOTE_CONFIDENCE;
    out.push({
      itemIndex: num, productId: product.id, productName: product.name,
      markedPrice: quote.markedPrice, unit: quote.unit, confidence: quote.confidence,
      quoteAgeDays: quote.quoteAgeDays, moq: quote.moq, deliveryDays: quote.deliveryDays,
      ...(caveated ? { caveated: true as const, missing: quote.missingSpecs.map((m) => m.question) } : {}),
      ...(bv.vague.length ? { vague: bv.vague } : {}),
      hasUsablePrices: true,
    });
    // Every variation per item lands in the combined table (per-row
    // Apply) — no top-N cut; the model + user rank the whole list.
    scored.forEach((s, si) => {
      rows.push(catalogueRow(product, guide, s, specs, required, si, { itemIndex: num, itemName, tag: 'Catalogue', maxBits: 3 }));
    });
  }
  await savePriceSession(ctx.enquiryId, who, { items: nextItems, activeItem: prev.activeItem });
  const proposals: ChatProposal[] = [
    ...(rows.length > 0 ? [{
      kind: 'price_table' as const,
      productName: 'Batch prices',
      rows, label: `Batch prices · ${out.filter((o) => typeof o.markedPrice === 'number').length}/${out.length} items priced`,
      needsProcurement: false as const,
    }] : []),
    ...unpriced,
  ];
  return { result: { items: out, proposed: rows.length > 0 }, proposals };
}
