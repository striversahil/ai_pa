"use client";

// KnownRatesPicker — ONE picker for both privileged desks (procurement +
// management). Shows the Product Line's known vendor rates for one enquiry
// item (name-mapped, server-side) as a selection; picking one hands the rate
// to the host, which writes it into the loop through its existing save path
// (procurement: Add-quote PATCH; management: staged insert + decide).
// Never mounted on the sales surface — vendor names stay privileged.
//
// Data: useLiveQuery over @/enquiry/api (domain api owns the fetch, never
// this component). No match logic here — the server resolves via
// resolveProduct / rankProducts.
import React, { useState } from "react";
import { useLiveQuery } from "@/hooks/useLiveData";
import { inr } from "@/lib/format";
import { fetchKnownRates, type KnownRateRow } from "@/enquiry/api";

export interface KnownRatesPickerProps {
  /** Enquiry item name (the mapping key). */
  itemName: string;
  /** Item spec / qty — fed to the AI fallback on a name miss (text only). */
  itemSpec?: string;
  itemQty?: string;
  /** Called with the picked known rate; the host maps it into a loop rate. */
  onSelect: (rate: KnownRateRow, productName: string) => void;
  /** Select button label per desk ("Add this quote" / "Use this rate"). */
  selectLabel: string;
  disabled?: boolean;
}

function specChips(rate: KnownRateRow, labels: Record<string, string>): string[] {
  return Object.entries(rate.specs ?? {})
    .map(([k, v]) => `${labels[k] ?? k}: ${String(v)}`.slice(0, 80))
    .filter(Boolean)
    .slice(0, 6);
}

export default function KnownRatesPicker({ itemName, itemSpec, itemQty, onSelect, selectLabel, disabled }: KnownRatesPickerProps) {
  const [productId, setProductId] = useState<string | null>(null);
  const name = itemName.trim();
  const spec = (itemSpec ?? "").trim().slice(0, 500);
  const qty = (itemQty ?? "").trim().slice(0, 120);
  const q = useLiveQuery(
    () => (name || productId ? fetchKnownRates(name, { spec, qty, productId: productId ?? undefined }) : Promise.resolve(null)),
    { events: [], deps: [name, spec, qty, productId ?? ""] },
  );
  const data = q.data;

  if (!name) return null;

  const picked = productId && data?.product && data.product.id === productId ? data.product : null;

  return (
    <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/5 p-2 space-y-2">
      <p className="text-[10px] font-extrabold uppercase tracking-wide text-indigo-500">
        📚 Known vendor rates{picked || data?.product ? ` — ${picked?.name ?? data?.product?.name}` : ""}{data?.source === "llm" ? " · AI-matched" : ""}
      </p>

      {q.loading ? (
        <p className="text-[11px] text-[var(--text-tertiary)]">Looking up known vendors…</p>
      ) : q.error ? (
        <p className="text-[11px] font-semibold text-[var(--color-danger)]">
          Lookup failed — quote manually as usual.
        </p>
      ) : data?.rates?.length ? (
        <ul className="space-y-1.5">
          {data.rates.map((r) => (
            <li key={r.id} className="rounded-lg border border-[var(--border-card)]/60 bg-white/50 dark:bg-black/20 px-2 py-1.5">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-bold text-[var(--text-primary)] truncate flex-1 min-w-0">{r.vendorName}</span>
                <span className="font-mono text-[var(--text-secondary)] whitespace-nowrap">{inr(r.pricePerUnit)}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(r, data.product?.name ?? "")}
                  className="px-2 py-1 bg-brand-indigo/10 text-brand-indigo hover:bg-brand-indigo/20 font-bold text-[10px] rounded-lg cursor-pointer border-0 whitespace-nowrap disabled:opacity-40"
                >
                  {selectLabel}
                </button>
              </div>
              {specChips(r, data.specLabels ?? {}).length > 0 && (
                <p className="mt-0.5 text-[10px] text-[var(--text-secondary)] leading-relaxed">
                  {specChips(r, data.specLabels ?? {}).join(" · ")}
                </p>
              )}
              <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">
                {[r.unit, r.discountPercent != null ? `${r.discountPercent}% off` : "", r.moq ? `MOQ ${r.moq}` : "", r.deliveryDays != null ? `${r.deliveryDays}d delivery` : "", r.quotedAt ? `quoted ${r.quotedAt.slice(0, 10)}` : ""].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      ) : data?.candidates?.length ? (
        <div className="space-y-1">
          <p className="text-[10px] text-[var(--text-secondary)]">Name matches {data.candidates.length} products — pick the right one:</p>
          <div className="flex flex-wrap gap-1.5">
            {data.candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setProductId(c.id)}
                className="px-2 py-1 rounded-full border border-indigo-500/30 bg-white/60 dark:bg-black/20 text-[11px] font-bold text-[var(--text-primary)] hover:bg-indigo-500/10 cursor-pointer"
              >
                {c.name}{c.category ? ` · ${c.category}` : ""}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-[var(--text-tertiary)]">No known vendors for this item — quote manually as usual.</p>
      )}
    </div>
  );
}
