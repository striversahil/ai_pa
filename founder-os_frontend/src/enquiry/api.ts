// api.ts — enquiry domain HTTP (the ONLY place that spells enquiry paths).
//
// Components never fetch("/api/enquiries/...") directly — hooks/components
// import from here. Live reads go through useLiveQuery/useLiveDashboard;
// this module owns the raw fetchers.
//
// Mirror: founder-os_backend/src/modules/enquiries/product-rates.ts
// (KnownRateRow wire shape) — change both together.

export interface KnownRateRow {
  id: string;
  vendorName: string;
  vendorType: string;
  pricePerUnit: number;
  unit: string;
  discountPercent: number | null;
  moq: string | null;
  deliveryDays: number | null;
  quotedAt: string;
  /** Captured spec snapshot (attrKey → value), displayed as-is. */
  specs: Record<string, string>;
}

export interface KnownRateCandidate {
  id: string;
  name: string;
  category: string;
  score: number;
}

export interface KnownRatesResult {
  product: { id: string; name: string; category: string; exact: boolean } | null;
  exact: boolean;
  /** How the product was found: confident deterministic tiers, or the AI
   *  fallback (the picker labels AI-matched rows for trust). */
  source: 'exact' | 'llm' | null;
  rates: KnownRateRow[];
  /** attrKey → guide question, so the picker labels specs (not raw slugs). */
  specLabels: Record<string, string>;
  candidates: KnownRateCandidate[];
}

/** Known Product Line vendor rates for one enquiry item — text only
 *  (name + spec + qty + dims feed the AI fallback on a name miss).
 *  Privileged desks only — the server 403s everyone else. */
export async function fetchKnownRates(
  name: string,
  opts?: { spec?: string; qty?: string; dims?: string; productId?: string },
): Promise<KnownRatesResult> {
  const params = new URLSearchParams();
  if (name) params.set("name", name);
  if (opts?.spec) params.set("spec", opts.spec);
  if (opts?.qty) params.set("qty", opts.qty);
  if (opts?.dims) params.set("dims", opts.dims);
  if (opts?.productId) params.set("productId", opts.productId);
  const res = await fetch(`/api/enquiries/product-rates?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`product rates load failed (${res.status})`);
  return res.json();
}
