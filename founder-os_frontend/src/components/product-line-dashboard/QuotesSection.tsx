"use client";

// Product detail → Vendor quotes. Moved out of ProductLineDashboard.tsx and
// paged (one product carries 2,400+ quotes): chips + compare cover the
// current page of 50; search and page numbers reach the rest.
import { useState } from "react";
import { Layers, Pencil, Plus, Search } from "lucide-react";
import { ChangesBanner, Pager } from "@/components/ui";
import type { PagedQuery } from "@/hooks/usePagedQuery";
import type { Detail, RateRow } from "./types";
import { attrLabel, field, fmtINR, ghostBtn, panel, shortDate, specSummary } from "./helpers";

export function QuotesSection({ detail, list, canQuote, onAdd, onEdit }: {
  detail: Detail;
  list: PagedQuery<RateRow>;
  canQuote: boolean;
  onAdd: () => void;
  onEdit: (r: RateRow) => void;
}) {
  const [pickedId, setSelRateId] = useState<string | null>(null);
  const [compareAll, setCompareAll] = useState(false);
  const rates = list.rows;
  // Picked quote if it is on this page, else the first active one, else the first.
  const selRate = rates.find((r) => r.id === pickedId) ?? rates.find((r) => r.active) ?? rates[0] ?? null;
  const selRateId = selRate?.id ?? null;
  const best = detail.product.bestPrice;
  const isBest = (r: RateRow) => best != null && r.active && r.pricePerUnit === best;
  const cmpRows: { label: string; get: (r: RateRow) => string }[] = [
    { label: "Price", get: (r) => (r.pricePerUnit != null ? `${fmtINR(r.pricePerUnit)}${r.unit ? ` / ${r.unit}` : ""}` : "—") },
    { label: "Discount", get: (r) => (r.discountPercent != null ? `${r.discountPercent}%` : "—") },
    { label: "MOQ", get: (r) => r.moq ?? "—" },
    { label: "Delivery", get: (r) => (r.deliveryDays != null ? `${r.deliveryDays} days` : "—") },
    ...[...new Set(rates.flatMap((r) => Object.keys(r.attrValues ?? {})))].map((k) => ({
      label: attrLabel(k, detail.guide),
      get: (r: RateRow) => r.attrValues?.[k] || "—",
    })),
  ];
  const commercialRows: [string, string, boolean][] = selRate
    ? [
        ["Price", selRate.pricePerUnit != null ? `${fmtINR(selRate.pricePerUnit)}${selRate.unit ? ` / ${selRate.unit}` : ""}` : "—", true],
        ["Discount", selRate.discountPercent != null ? `${selRate.discountPercent}%` : "—", false],
        ["Base rate", fmtINR(selRate.baseRate), false],
        ["MOQ", selRate.moq ?? "—", false],
        ["Weight / unit", selRate.weightPerUnit != null ? `${selRate.weightPerUnit} kg` : "—", false],
        ["Pack qty", selRate.packageQty ?? "—", false],
        ["Pack dims", selRate.packageDims ?? "—", false],
        ["Delivery", selRate.deliveryDays != null ? `${selRate.deliveryDays} days` : "—", false],
        ["Quoted", shortDate(selRate.quotedAt), false],
      ]
    : [];

  return (
    <section className={`${panel} p-5`}>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <h3 className="font-extrabold tracking-tight text-[var(--text-primary)]">Vendor quotes</h3>
        <span className="text-xs tabular-nums text-[var(--text-tertiary)]">{detail.product.rateCount.toLocaleString("en-IN")}</span>
        <span className="flex-1" />
        {canQuote && <button type="button" onClick={onAdd} className={ghostBtn}><Plus size={13} /> Quote</button>}
        {rates.length > 1 && (
          <button type="button" onClick={() => setCompareAll(!compareAll)} className={ghostBtn}><Layers size={13} /> {compareAll ? "Single view" : "Compare this page"}</button>
        )}
      </div>
      <p className="mb-3 text-xs text-[var(--text-tertiary)]">Each quote is pinned to the exact spec combination it was given for — same product, different spec, never conflated.</p>
      {detail.product.rateCount > 0 && (
        <div className="relative mb-3 w-full sm:w-80">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input value={list.q} onChange={(e) => list.setQ(e.target.value)} placeholder="Search vendor, spec, notes…" className={`${field} !pl-9`} />
        </div>
      )}
      <div className="mb-3"><ChangesBanner count={list.changes} onRefresh={list.refresh} /></div>
      {list.loading && !list.hasData && <p className="py-4 text-center text-sm text-[var(--text-tertiary)]">Loading quotes…</p>}
      {list.hasData && rates.length === 0 && (
        <p className="py-4 text-center text-sm text-[var(--text-tertiary)]">{list.q ? "No quotes match this search." : "No vendor quotes recorded for this product yet."}</p>
      )}

      <div className={list.loading && list.hasData ? "opacity-60" : ""}>
        {!compareAll && rates.length > 0 && (
          <>
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Vendor quotes">
              {rates.map((r) => {
                const active = r.id === selRateId;
                return (
                  <button key={r.id} type="button" role="tab" aria-selected={active} onClick={() => setSelRateId(r.id)}
                    className={`flex-shrink-0 rounded-xl border-2 px-3.5 py-2.5 text-left cursor-pointer bg-transparent ${active ? "border-brand-indigo" : "border-[var(--border-card)]"}`}>
                    <p className={`text-[13px] font-extrabold ${active ? "text-brand-indigo" : "text-[var(--text-primary)]"}`}>
                      {r.vendorName ?? "Unknown"}{r.active ? "" : " · off"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">{specSummary(r)}</p>
                    <p className="mt-0.5 text-[13px] font-extrabold tabular-nums text-[var(--text-primary)]">
                      {r.pricePerUnit != null ? `${fmtINR(r.pricePerUnit)}${r.unit ? `/${r.unit}` : ""}` : "No price"}
                    </p>
                  </button>
                );
              })}
            </div>
            {selRate && (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
                {(selRate.imageUrl || selRate.videoUrl) && (
                  <div className="lg:col-span-5 flex flex-wrap items-start gap-4 rounded-xl border border-[var(--border-card)]/80 p-4">
                    {selRate.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={selRate.imageUrl} alt={`${selRate.vendorName ?? "vendor"} item`}
                        className="h-32 w-32 rounded-xl border border-[var(--border-card)] object-cover" />
                    )}
                    {selRate.videoUrl && (
                      <div className="min-w-60 flex-1 max-w-md">
                        <p className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">Manufacturing video</p>
                        {/\.(mp4|webm|mov)(\?|$)/i.test(selRate.videoUrl) ? (
                          <video src={selRate.videoUrl} controls preload="none" className="w-full rounded-xl border border-[var(--border-card)]" />
                        ) : (
                          <a href={selRate.videoUrl} target="_blank" rel="noreferrer" className="text-sm font-bold text-brand-indigo hover:underline">Watch manufacturing video →</a>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="lg:col-span-3 rounded-xl border border-[var(--border-card)]/80 overflow-hidden">
                  <p className="px-4 py-2.5 text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-card)]/70">
                    Spec as quoted · {selRate.vendorName}{selRate.vendorType ? ` — ${selRate.vendorType}` : ""}
                    {(selRate.missingSpecs ?? []).length > 0 && (
                      <span title={`Specs unknown at filing:\n${(selRate.missingSpecs ?? []).join("\n")}`} className="ml-2 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-600">specs missing ({(selRate.missingSpecs ?? []).length})</span>
                    )}
                  </p>
                  {Object.keys(selRate.attrValues ?? {}).length === 0 && !selRate.notes && <p className="px-4 py-3 text-sm text-[var(--text-tertiary)]">No spec breakup recorded on this quote.</p>}
                  <dl>
                    {Object.entries(selRate.attrValues ?? {}).map(([k, v]) => (
                      <div key={k} className="flex gap-3 px-4 py-2 border-b border-[var(--border-card)]/50 last:border-0">
                        <dt className="w-2/5 flex-shrink-0 text-xs leading-relaxed text-[var(--text-secondary)]">{attrLabel(k, detail.guide)}</dt>
                        <dd className="flex-1 text-[13px] font-bold text-[var(--text-primary)]">{v || "—"}</dd>
                      </div>
                    ))}
                    {selRate.notes && (
                      <div className="flex gap-3 px-4 py-2 border-b border-[var(--border-card)]/50 last:border-0 bg-amber-500/[0.04]">
                        <dt className="w-2/5 flex-shrink-0 text-xs leading-relaxed text-[var(--text-secondary)]">Notes (non-spec extras)</dt>
                        <dd className="flex-1 text-[13px] font-bold text-[var(--text-primary)] whitespace-pre-wrap">{selRate.notes}</dd>
                      </div>
                    )}
                  </dl>
                </div>
                <div className="lg:col-span-2 rounded-xl border border-[var(--border-card)]/80 overflow-hidden h-fit">
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-card)]/70">
                    <p className="flex-1 text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">Commercials</p>
                    {canQuote && <button type="button" onClick={() => onEdit(selRate)} className={ghostBtn}><Pencil size={12} /> Edit quote</button>}
                  </div>
                  <dl className="px-4 py-1">
                    {commercialRows.map(([k, v, hero]) => (
                      <div key={k} className="flex items-baseline justify-between gap-3 border-b border-[var(--border-card)]/50 py-2 last:border-0">
                        <dt className="text-xs text-[var(--text-secondary)]">{k}</dt>
                        <dd className={`tabular-nums ${hero ? "text-base font-extrabold text-[var(--text-primary)]" : "text-[13px] font-bold text-[var(--text-primary)]"}`}>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            )}
          </>
        )}

        {compareAll && rates.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-[var(--border-card)]/80">
            <table className="w-full text-sm min-w-[620px] border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-[var(--bg-card)] py-2.5 pl-4 pr-3 text-left text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">Field</th>
                  {rates.map((r) => (
                    <th key={r.id} className="py-2.5 px-3 text-left align-top">
                      <p className="text-[13px] font-extrabold text-[var(--text-primary)]">{r.vendorName ?? "—"}</p>
                      {isBest(r) && <span className="mt-0.5 inline-block rounded-full bg-emerald-500/15 px-2 py-px text-[10px] font-extrabold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Best price</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cmpRows.map((row) => (
                  <tr key={row.label} className="border-t border-[var(--border-card)]/60">
                    <td className="sticky left-0 bg-[var(--bg-card)] py-2 pl-4 pr-3 text-xs text-[var(--text-secondary)] whitespace-nowrap max-w-52 truncate" title={row.label}>{row.label}</td>
                    {rates.map((r) => (
                      <td key={r.id} className={`py-2 px-3 text-[13px] tabular-nums align-top ${row.label === "Price" ? "font-extrabold text-[var(--text-primary)]" : "text-[var(--text-primary)]"}`}>{row.get(r)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {list.hasData && list.total > 0 && (
        <Pager page={list.page} limit={list.limit} total={list.total} totalPages={list.totalPages} onPage={list.setPage} noun="quotes" />
      )}
    </section>
  );
}
