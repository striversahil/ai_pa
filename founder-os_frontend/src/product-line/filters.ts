// filters.ts — rate-sheet filter state → D1 query string.
//
// MIRROR: founder-os_backend/src/automations/product-line/service-parts/
// rates-page.ts (RateListFilter) + spec-index.ts (parseSpecFilters syntax).
// Guard: scripts/guards/kyp-schema.test.mjs asserts the spec-op vocabulary.

export const RATES_PAGE_MAX = 500;
export const RATES_PAGE_DEFAULT = 100;

export const SPEC_OPS = ["eq", "in", "gte", "lte", "between"] as const;
export type SpecOp = (typeof SPEC_OPS)[number];

export interface SpecFilter {
  key: string;
  op: SpecOp;
  value: string;
  value2?: string;
}

export interface RateFilters {
  q: string;
  productId: string;
  category: string;
  vendorId: string;
  /** Restrict to one paste (the batch log's "view rates"). */
  batchId: string;
  status: "" | "on" | "off";
  priceMin: string;
  priceMax: string;
  netMin: string;
  netMax: string;
  leadMin: string;
  leadMax: string;
  from: string;
  to: string;
  /** "" = every row, "any" = still misses something, "spec" only, "envelope" only. */
  missing: "" | "any" | "spec" | "envelope";
  sort: string;
  specs: SpecFilter[];
}

export const EMPTY_FILTERS: RateFilters = {
  q: "",
  productId: "",
  category: "",
  vendorId: "",
  batchId: "",
  status: "",
  priceMin: "",
  priceMax: "",
  netMin: "",
  netMax: "",
  leadMin: "",
  leadMax: "",
  from: "",
  to: "",
  missing: "",
  sort: "date",
  specs: [],
};

/** How many filter groups are active (badge on the Filters button). */
export function activeFilterCount(f: RateFilters): number {
  let n = f.specs.length;
  for (const key of [
    "category",
    "vendorId",
    "batchId",
    "productId",
    "status",
    "priceMin",
    "priceMax",
    "netMin",
    "netMax",
    "leadMin",
    "leadMax",
    "from",
    "to",
  ] as const) {
    if (String(f[key] ?? "").trim()) n += 1;
  }
  if (f.missing) n += 1;
  return n;
}

/** `key:expr` — the syntax the server's parseSpecFilters() accepts. */
export function specToExpr(s: SpecFilter): string {
  const v = s.value.trim();
  if (!v) return "";
  switch (s.op) {
    case "gte":
      return `${s.key}:>=${v}`;
    case "lte":
      return `${s.key}:<=${v}`;
    case "between":
      return `${s.key}:${v}..${(s.value2 ?? "").trim()}`;
    case "in":
      return `${s.key}:in:${v.split(",").map((x) => x.trim()).filter(Boolean).join(",")}`;
    default:
      return `${s.key}:${v}`;
  }
}

export function toQuery(f: RateFilters, page: number, limit: number): string {
  const p = new URLSearchParams();
  p.set("page", String(Math.max(1, page)));
  p.set("limit", String(Math.min(RATES_PAGE_MAX, Math.max(1, limit))));
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.productId) p.set("productId", f.productId);
  if (f.category) p.set("category", f.category);
  if (f.vendorId) p.set("vendorId", f.vendorId);
  if (f.batchId) p.set("batchId", f.batchId);
  if (f.status) p.set("status", f.status);
  for (const key of ["priceMin", "priceMax", "netMin", "netMax", "leadMin", "leadMax", "from", "to"] as const) {
    const v = String(f[key] ?? "").trim();
    if (v) p.set(key, v);
  }
  if (f.missing) p.set("missing", f.missing === "any" ? "1" : f.missing);
  if (f.sort) p.set("sort", f.sort);
  for (const spec of f.specs) {
    const expr = specToExpr(spec);
    if (expr) p.append("spec", expr);
  }
  return p.toString();
}

export const MISSING_OPTIONS: { id: RateFilters["missing"]; text: string }[] = [
  { id: "", text: "All rows" },
  { id: "any", text: "Incomplete only" },
  { id: "spec", text: "Spec gaps" },
  { id: "envelope", text: "Envelope gaps" },
];

/**
 * Missing required values for one quote, labelled with the live catalogue.
 * mirror: founder-os_backend/src/automations/product-line/service-parts/missing.ts
 * (guard `kyp-schema` runs both on the same fixture and diffs the labels).
 */
export function missingFields(
  rate: { attrValues?: Record<string, unknown>; unit?: string; moq?: string | null; pricePerUnit?: number | null; deliveryDays?: number | null; quotedAt?: string },
  product?: { props: Record<string, { label: string }>; required: string[] } | null,
): string[] {
  const out: string[] = [];
  const specs = rate.attrValues ?? {};
  for (const key of product?.required ?? []) {
    const v = specs[key];
    const empty = v === undefined || v === null || String(v).trim() === "" || (Array.isArray(v) && !v.length);
    if (empty) out.push(product?.props?.[key]?.label ?? key.replace(/_/g, " "));
  }
  if (!String(rate.unit ?? "").trim()) out.push("Unit of sale");
  if (!String(rate.moq ?? "").trim()) out.push("MOQ");
  if (rate.pricePerUnit == null || !(Number(rate.pricePerUnit) > 0)) out.push("Price per unit");
  if (rate.deliveryDays == null) out.push("Delivery time");
  if (!String(rate.quotedAt ?? "").trim()) out.push("Date added");
  return out;
}
