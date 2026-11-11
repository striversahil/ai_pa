"use client";
import React from "react";
import type { StockLine } from "./shared";
import { statusPill, abcBadge, inr } from "./shared";

export default function InventoryTable({ rows, closings, days, onPick }: {
  rows: StockLine[]; closings: Record<string, Record<string, number>>; days: string[]; onPick: (id: string) => void;
}) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl overflow-x-auto">
      <table className="w-full text-sm min-w-[1100px]">
        <thead><tr className="text-left text-[11px] uppercase tracking-wider opacity-60">
          <th className="p-3">SKU (auto)</th><th className="p-3">Product</th><th className="p-3">Avail / On-hand</th><th className="p-3">Cons/d</th><th className="p-3">Max</th><th className="p-3">To order</th><th className="p-3">Value</th><th className="p-3">Status</th><th className="p-3">ABC</th><th className="p-3">Closing ({days.slice(-5).join(" · ")})</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-[var(--border-card)] hover:bg-[var(--bg-input)] cursor-pointer" onClick={() => onPick(r.id)}>
              <td className="p-3 font-mono font-bold">{r.sku}<div className="text-[10px] font-sans font-normal opacity-50">{r.category} {r.brand}</div></td>
              <td className="p-3">{r.productName}<div className="opacity-50 text-xs">{r.unit} · {r.supplier}</div></td>
              <td className="p-3 font-bold">{r.available}<span className="font-normal opacity-50 text-xs"> / {r.onHand}{r.reserved > 0 ? ` (−${r.reserved} res)` : ""}</span></td>
              <td className="p-3 font-mono">{r.avgDailyConsumption > 0 ? r.avgDailyConsumption.toFixed(2) : "—"}</td>
              <td className="p-3 font-mono">{r.maxLevel > 0 ? r.maxLevel : "—"}</td>
              <td className="p-3 font-bold">{r.pendingToOrder > 0 ? r.pendingToOrder : "—"}</td>
              <td className="p-3">{inr(r.stockValue)}<div className="opacity-50 text-xs">@ {inr(r.avgRate)}</div></td>
              <td className="p-3">{statusPill(r.status)}</td>
              <td className="p-3">{abcBadge(r.abc)}</td>
              <td className="p-3 font-mono text-xs opacity-80">{days.slice(-5).map((d) => closings?.[r.id]?.[d] ?? 0).join(" → ")}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={10} className="p-6 text-center opacity-60 text-sm">No SKUs match — add the first item below.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
