"use client";

// RatesFilters.tsx — the query builder for the rates sheet.
//
// Founder decision 2026-11-23 (v2): the filters sit spread across the width like
// a dashboard, and NOTHING is queried until "Run query" is pressed — a dozen
// range fields then cost one D1 request instead of a dozen. Every control is a
// server param: D1 filters and pages; the sheet only paints the answer.
import React from "react";
import { Play, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { field, ghostBtn, iconBtn, label, primaryBtn } from "../product-line-dashboard/helpers";
import {
  MISSING_OPTIONS,
  activeFilterCount,
  specToExpr,
  type RateFilters,
  type SpecFilter,
  type SpecOp,
} from "@/product-line/filters";
import type { KypProduct, VendorRow } from "@/product-line/types";

const OPS: { id: SpecOp; text: string }[] = [
  { id: "eq", text: "is" },
  { id: "in", text: "is any of" },
  { id: "gte", text: "≥" },
  { id: "lte", text: "≤" },
  { id: "between", text: "between" },
];

const SORTS: { id: string; text: string }[] = [
  { id: "date", text: "Newest first" },
  { id: "date-asc", text: "Oldest first" },
  { id: "price", text: "Price ↓" },
  { id: "price-asc", text: "Price ↑" },
  { id: "net", text: "Net ↓" },
  { id: "net-asc", text: "Net ↑" },
  { id: "lead-asc", text: "Fastest delivery" },
  { id: "vendor", text: "Vendor A→Z" },
  { id: "product", text: "Product A→Z" },
];

const mini = `${field} h-8 text-[11px] py-1`;

interface Props {
  draft: RateFilters;
  patch: (patch: Partial<RateFilters>) => void;
  run: () => void;
  reset: () => void;
  dirty: boolean;
  categories: string[];
  vendors: VendorRow[];
  products: KypProduct[];
  total: number;
}

export function RatesFilters({ draft, patch, run, reset, dirty, categories, vendors, products, total }: Props) {
  const active = activeFilterCount(draft);
  const product = products.find((p) => p.id === draft.productId) ?? null;
  const specKeys = product ? Object.keys(product.props) : [];

  const addSpec = () => patch({ specs: [...draft.specs, { key: specKeys[0] ?? "brand", op: "eq", value: "" }] });
  const patchSpec = (i: number, p: Partial<SpecFilter>) =>
    patch({ specs: draft.specs.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const dropSpec = (i: number) => patch({ specs: draft.specs.filter((_, j) => j !== i) });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !(e.target as HTMLElement).matches("select, textarea")) run();
  };

  const range = (
    name: "price" | "net" | "lead" | "date",
    title: string,
    fromKey: keyof RateFilters,
    toKey: keyof RateFilters,
    type = "text",
  ) => (
    <div className="min-w-0">
      <span className={label}>{title}</span>
      <div className="flex items-center gap-1">
        <input
          className={mini}
          type={type}
          inputMode={type === "date" ? undefined : "decimal"}
          placeholder="from"
          value={String(draft[fromKey] ?? "")}
          onChange={(e) => patch({ [fromKey]: e.target.value } as Partial<RateFilters>)}
        />
        <span className="text-[10px] text-[var(--text-tertiary)]">–</span>
        <input
          className={mini}
          type={type}
          inputMode={type === "date" ? undefined : "decimal"}
          placeholder="to"
          value={String(draft[toKey] ?? "")}
          onChange={(e) => patch({ [toKey]: e.target.value } as Partial<RateFilters>)}
        />
      </div>
    </div>
  );

  return (
    <div
      className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3 space-y-3"
      onKeyDown={onKeyDown}
    >
      {/* Row 1 — the slice */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
        <div className="col-span-2">
          <span className={label}>Search</span>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <input
              className={`${mini} pl-8`}
              placeholder="product, vendor, spec value, notes…"
              value={draft.q}
              onChange={(e) => patch({ q: e.target.value })}
            />
          </div>
        </div>
        <div>
          <span className={label}>Product</span>
          <select className={mini} value={draft.productId} onChange={(e) => patch({ productId: e.target.value, specs: [] })}>
            <option value="">All products</option>
            {[...new Set(products.map((p) => p.category))].sort().map((c) => (
              <optgroup key={c} label={c}>
                {products.filter((p) => p.category === c).sort((a, b) => a.label.localeCompare(b.label)).map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <span className={label}>Category</span>
          <select className={mini} value={draft.category} onChange={(e) => patch({ category: e.target.value })}>
            <option value="">All</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <span className={label}>Vendor</span>
          <select className={mini} value={draft.vendorId} onChange={(e) => patch({ vendorId: e.target.value })}>
            <option value="">All vendors</option>
            {(vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <span className={label}>Status</span>
          <select className={mini} value={draft.status} onChange={(e) => patch({ status: e.target.value as RateFilters["status"] })}>
            <option value="">Live + off</option>
            <option value="on">Live only</option>
            <option value="off">Turned off</option>
          </select>
        </div>
        <div>
          <span className={label}>Completeness</span>
          <select className={mini} value={draft.missing} onChange={(e) => patch({ missing: e.target.value as RateFilters["missing"] })}>
            {MISSING_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
          </select>
        </div>
      </div>

      {/* Row 2 — the ranges, spread */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-2">
        {range("price", "Price per unit", "priceMin", "priceMax")}
        {range("net", "Net rate", "netMin", "netMax")}
        {range("lead", "Delivery (days)", "leadMin", "leadMax")}
        {range("date", "Quoted between", "from", "to", "date")}
        <div>
          <span className={label}>Sort</span>
          <select className={mini} value={draft.sort} onChange={(e) => patch({ sort: e.target.value })}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.text}</option>)}
          </select>
        </div>
      </div>

      {/* Row 3 — typed spec predicates (indexed by D1) */}
      <div className="border-t border-[var(--border-card)] pt-2 space-y-2">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={12} className="text-[var(--text-tertiary)]" />
          <span className={label}>Spec filters</span>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            {product ? `keys of ${product.label}` : "pick a product for its keys — any key works"}
          </span>
          <button type="button" className={`${ghostBtn} ml-auto`} onClick={addSpec}>+ Add spec filter</button>
        </div>
        {draft.specs.length ? (
          <div className="flex flex-wrap gap-1.5">
            {draft.specs.map((s, i) => (
              <div key={i} className="flex items-center gap-1 rounded-xl bg-[var(--bg-input)] px-1.5 py-1">
                {specKeys.length ? (
                  <select className={`${mini} w-40`} value={s.key} onChange={(e) => patchSpec(i, { key: e.target.value })}>
                    {specKeys.map((k) => <option key={k} value={k}>{product?.props[k]?.label ?? k}</option>)}
                    <option value="brand">brand</option>
                  </select>
                ) : (
                  <input className={`${mini} w-40`} placeholder="spec key" value={s.key} onChange={(e) => patchSpec(i, { key: e.target.value })} />
                )}
                <select className={`${mini} w-24`} value={s.op} onChange={(e) => patchSpec(i, { op: e.target.value as SpecOp })}>
                  {OPS.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
                </select>
                <input
                  className={`${mini} w-32`}
                  placeholder={s.op === "in" ? "ss, gi" : s.op === "between" ? "from" : "value"}
                  value={s.value}
                  onChange={(e) => patchSpec(i, { value: e.target.value })}
                />
                {s.op === "between" ? (
                  <input className={`${mini} w-20`} placeholder="to" value={s.value2 ?? ""} onChange={(e) => patchSpec(i, { value2: e.target.value })} />
                ) : null}
                <button type="button" className={iconBtn} onClick={() => dropSpec(i)} aria-label="Remove filter"><X size={12} /></button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-[var(--text-tertiary)]">
            e.g. brand is PIX · width_mm ≥ 1000 · material is any of ss, gi — answered from the typed spec index, not a table scan.
          </p>
        )}
      </div>

      {/* Row 4 — run */}
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-card)] pt-2">
        <button type="button" className={primaryBtn} onClick={run}>
          <Play size={13} /> Run query{dirty ? " •" : ""}
        </button>
        <button type="button" className={ghostBtn} onClick={reset}>
          <RotateCcw size={13} /> Clear
        </button>
        <span className="text-[11px] text-[var(--text-tertiary)]">
          {active ? `${active} filter${active === 1 ? "" : "s"} applied` : "no filters — whole rate book"}
          {dirty ? " · changes not run yet" : ""}
        </span>
        <span className="ml-auto text-[11px] font-semibold tabular-nums text-[var(--text-tertiary)]">
          {total.toLocaleString("en-IN")} matching quotes
        </span>
      </div>
    </div>
  );
}
