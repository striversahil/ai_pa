"use client";

// RatesSheet.tsx — vendor rates as a dense spreadsheet.
//
// Column order (founder decision 2026-11-23 v3): Product · Vendor · MISSING ·
// Brand · Specs · Price · Net · Unit · MOQ · Delivery · Quoted · Status. The
// completeness column sits right after the vendor so a gap is impossible to
// miss; complete rows read "Complete" with a green tick, incomplete ones open a
// styled card naming every field still owed.
import React from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, X } from "lucide-react";
import { fmtINR, ghostBtn, panel, shortDate } from "../product-line-dashboard/helpers";
import { RATES_PAGE_MAX } from "@/product-line/filters";
import type { LiveCatalog, RateRow } from "@/product-line/types";
import { RatesFilters } from "./RatesFilters";
import { SheetSkeleton } from "./Skeletons";
import type { Payload, VendorRow } from "@/product-line/types";
import type { UseRatesResult } from "@/product-line/hooks";

const COLS =
  "minmax(160px,1.4fr) minmax(112px,1fr) 118px 58px minmax(140px,1.1fr) 94px 86px 54px 50px 60px 70px 48px";

const cell = "px-2 py-1 text-[10.5px] leading-4 text-[var(--text-secondary)] truncate";
const num = "px-2 py-1 text-[10.5px] leading-4 text-right tabular-nums text-[var(--text-primary)] whitespace-nowrap";

function brandOf(rate: RateRow): string {
  const v = (rate.attrValues ?? {})["brand"];
  return v == null ? "" : String(v);
}

function specSummary(rate: RateRow, label: (k: string) => string): string {
  const entries = Object.entries(rate.attrValues ?? {}).filter(([k]) => k !== "brand");
  if (!entries.length) return "—";
  return entries
    .slice(0, 4)
    .map(([k, v]) => `${label(k)} ${Array.isArray(v) ? v.join("/") : String(v)}`)
    .join(" · ");
}

/** "Complete" tick, or a red count whose hover card lists what is missing. */
function CompletenessBadge({ fields }: { fields: string[] }) {
  if (!fields.length) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/12 text-[9.5px] font-bold text-emerald-700 whitespace-nowrap"
        title="Every required field is answered"
      >
        <CheckCircle2 size={10} /> Complete
      </span>
    );
  }
  return (
    <span className="relative inline-flex group focus-within:z-30">
      <button
        type="button"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[color-mix(in_srgb,var(--color-danger)_14%,transparent)] text-[9.5px] font-bold text-[var(--color-danger)] whitespace-nowrap cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-danger)]/40"
        aria-label={`${fields.length} required fields missing`}
      >
        <AlertTriangle size={9} /> Missing ({fields.length})
      </button>

      {/* Hover / focus card: why it is red and what to fill. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 bottom-full mb-1.5 hidden group-hover:block group-focus-within:block z-30 w-60"
      >
        <span className="block rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] shadow-2xl overflow-hidden">
          <span className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] border-b border-[var(--border-card)]">
            <AlertTriangle size={11} className="text-[var(--color-danger)]" />
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--color-danger)]">
              Needs {fields.length} more field{fields.length === 1 ? "" : "s"}
            </span>
          </span>
          <span className="block max-h-44 overflow-hidden px-2.5 py-1.5">
            {fields.map((f, i) => (
              <span key={f} className="flex items-start gap-1.5 py-0.5">
                <span className="mt-[3px] h-1.5 w-1.5 rounded-full bg-[var(--color-danger)] shrink-0" />
                <span className="text-[10.5px] leading-4 font-semibold text-[var(--text-primary)]">
                  {i + 1}. {f}
                </span>
              </span>
            ))}
          </span>
          <span className="block px-2.5 py-1 text-[9.5px] text-[var(--text-tertiary)] border-t border-[var(--border-card)]">
            Open the row to fill these in
          </span>
        </span>
      </span>
    </span>
  );
}

interface Props {
  rates: UseRatesResult;
  catalog: LiveCatalog | null;
  payload: Payload | null;
  vendors: VendorRow[];
  onOpen: (id: string) => void;
  canEdit: boolean;
}

export function RatesSheet({ rates, catalog, payload, vendors, onOpen, canEdit }: Props) {
  const byId = React.useMemo(
    () => new Map((catalog?.products ?? []).map((p) => [p.id, p])),
    [catalog],
  );
  const batch = rates.applied.batchId;
  const labelFor = (productId: string | null) => (key: string) =>
    (productId ? byId.get(productId)?.props?.[key]?.label : undefined) ?? key.replace(/_/g, " ");
  const withMissing = rates.rows.filter((r) => (r.missingFields ?? []).length > 0).length;

  return (
    <div className="space-y-2.5">
      <RatesFilters
        draft={rates.draft}
        patch={rates.patch}
        run={rates.run}
        reset={rates.resetFilters}
        dirty={rates.dirty}
        categories={catalog?.categories ?? []}
        vendors={vendors}
        products={catalog?.products ?? []}
        total={rates.total}
      />

      <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-[var(--text-tertiary)]">
        <span className="tabular-nums">
          Showing <span className="text-[var(--text-primary)]">{rates.rows.length}</span> of{" "}
          <span className="text-[var(--text-primary)]">{rates.total.toLocaleString("en-IN")}</span>
        </span>
        {batch ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-brand-indigo/10 text-brand-indigo text-[10px] font-bold">
            batch {batch.slice(0, 10)}…
            <button
              type="button"
              aria-label="Clear batch filter"
              className="hover:text-[var(--text-primary)]"
              onClick={() => {
                rates.patch({ batchId: "" });
                rates.run();
              }}
            >
              <X size={10} />
            </button>
          </span>
        ) : null}
        {withMissing ? (
          <span className="inline-flex items-center gap-1 text-[var(--color-danger)]">
            <AlertTriangle size={11} /> {withMissing} on this page miss a required field
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          Rows
          <select
            className="px-1.5 py-0.5 rounded-md bg-[var(--bg-input)] border border-[var(--border-card)] text-[11px] font-bold"
            value={rates.limit}
            onChange={(e) => rates.setLimit(Number(e.target.value))}
          >
            {[50, 100, 250, RATES_PAGE_MAX].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </span>
      </div>

      <div className={`${panel} overflow-visible`}>
        <div className="overflow-x-auto">
          <div className="min-w-[1080px]">
            <div
              className="grid sticky top-0 z-[1] bg-[var(--bg-card)] border-b border-[var(--border-card)]"
              style={{ gridTemplateColumns: COLS }}
            >
              {["Product", "Vendor", "Completeness", "Brand", "Specs", "Price · disc", "Net rate", "Unit", "MOQ", "Delivery", "Quoted", "Status"].map((h, i) => (
                <span
                  key={h}
                  className={`${i >= 5 && i <= 9 ? "text-right" : ""} px-2 py-1.5 text-[9.5px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]`}
                >
                  {h}
                </span>
              ))}
            </div>

            {rates.loading && !rates.rows.length ? (
              <SheetSkeleton rows={18} cols={9} compact />
            ) : (
              <div className="divide-y divide-[var(--border-card)]/40">
                {rates.rows.map((r) => {
                  const product = byId.get(String(r.productId ?? "")) ?? null;
                  const missing = r.missingFields ?? [];
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onOpen(r.id)}
                      disabled={!canEdit}
                      className={`w-full grid items-center text-left transition-colors ${
                        canEdit ? "hover:bg-[var(--bg-input)]" : "cursor-default"
                      } ${missing.length ? "bg-[color-mix(in_srgb,var(--color-danger)_3%,transparent)]" : ""}`}
                      style={{ gridTemplateColumns: COLS }}
                    >
                      <span className={cell}>
                        <span className="block font-bold text-[var(--text-primary)] truncate">{r.productName ?? "—"}</span>
                        <span className="block text-[9px] text-[var(--text-tertiary)] truncate">{r.category ?? product?.category ?? ""}</span>
                      </span>
                      <span className={cell} title={r.vendorName ?? ""}>{r.vendorName ?? "—"}</span>
                      <span className="px-2 py-1">
                        <CompletenessBadge fields={missing} />
                      </span>
                      <span className={cell}>{brandOf(r) || "—"}</span>
                      <span className={cell} title={specSummary(r, labelFor(r.productId))}>{specSummary(r, labelFor(r.productId))}</span>
                      <span className={num}>
                        {fmtINR(r.pricePerUnit)}
                        {r.discountPercent ? (
                          <span className="ml-1 text-[9px] font-semibold text-[var(--text-tertiary)]">−{r.discountPercent}%</span>
                        ) : null}
                      </span>
                      <span className={`${num} font-extrabold`}>{fmtINR(r.baseRate)}</span>
                      <span className={cell}>{r.unit || "—"}</span>
                      <span className={num}>{r.moq ?? "—"}</span>
                      <span className={num}>
                        {r.deliveryDays == null
                          ? "—"
                          : r.deliveryMaxDays != null && r.deliveryMaxDays !== r.deliveryDays
                            ? `${r.deliveryDays}–${r.deliveryMaxDays}d`
                            : `${r.deliveryDays}d`}
                      </span>
                      <span className={cell}>{shortDate(r.quotedAt)}</span>
                      <span className={`${cell} pt-0`}>
                        <span className={`inline-block px-1 py-px rounded text-[9px] font-bold ${r.active ? "bg-emerald-500/12 text-emerald-600" : "bg-[var(--bg-input)] text-[var(--text-tertiary)]"}`}>
                          {r.active ? "live" : "off"}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {!rates.rows.length && !rates.loading ? (
                  <div className="px-4 py-12 text-center text-xs text-[var(--text-tertiary)]">
                    No vendor rates match this query.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" className={ghostBtn} disabled={rates.page <= 1} onClick={() => rates.setPage(rates.page - 1)}>
          <ChevronLeft size={13} /> Prev
        </button>
        <span className="text-[11px] font-semibold text-[var(--text-tertiary)] tabular-nums">
          Page {rates.page} of {rates.totalPages}
        </span>
        <button type="button" className={ghostBtn} disabled={rates.page >= rates.totalPages} onClick={() => rates.setPage(rates.page + 1)}>
          Next <ChevronRight size={13} />
        </button>
        {rates.refreshing ? <span className="text-[11px] text-[var(--text-tertiary)]">refreshing…</span> : null}
      </div>
    </div>
  );
}
