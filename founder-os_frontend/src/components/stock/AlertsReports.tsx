"use client";
import React from "react";
import { inr } from "./shared";

export default function AlertsReports({ items, closings, days }: { items: any[]; closings: Record<string, Record<string, number>>; days: string[] }) {
  const act = items.filter((r) => r.active && r.status !== 'ok').sort((a, b) => a.available - b.available);
  const dead = items.filter((r) => r.active && r.deadDays >= 90).sort((a, b) => b.stockValue - a.stockValue).slice(0, 20);
  const toOrder = items.filter((r) => r.active && Number(r.pendingToOrder ?? 0) > 0)
    .sort((a, b) => Number(b.pendingToOrder) - Number(a.pendingToOrder));
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-4">
        <h3 className="font-bold text-sm mb-2">Pending to order — MOQ-rounded ({toOrder.length} SKUs · {toOrder.reduce((s, r) => s + Number(r.pendingToOrder ?? 0), 0).toLocaleString('en-IN')} m)</h3>
        <div className="space-y-2 max-h-[420px] overflow-auto">
          {toOrder.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-sm border-b border-[var(--border-card)] pb-2">
              <div><span className="font-mono font-bold">{r.sku}</span> <span className="opacity-70">{r.productName}</span>
                <div className="text-xs opacity-50">cons {Number(r.avgDailyConsumption ?? 0).toFixed(2)}/d · avail {r.available} / max {r.maxLevel} → order <b>{r.pendingToOrder}</b> {r.unit} (MOQ {r.moq})</div></div>
              <div className="font-bold">{inr(r.stockValue)}</div>
            </div>
          ))}
          {toOrder.length === 0 && <div className="text-sm opacity-60">Nothing to order — all SKUs at or above max level.</div>}
        </div>
        <h3 className="font-bold text-sm mt-4 mb-2">Reorder queue ({act.length})</h3>
        <div className="space-y-2 max-h-[200px] overflow-auto">
          {act.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-sm border-b border-[var(--border-card)] pb-2">
              <div><span className="font-mono font-bold">{r.sku}</span> <span className="opacity-70">{r.productName}</span>
                <div className="text-xs opacity-50">avail {r.available} / reorder {r.reorderLevel}</div></div>
              <div className="font-bold">{inr(r.stockValue)}</div>
            </div>
          ))}
          {act.length === 0 && <div className="text-sm opacity-60">Nothing in reorder — all SKUs above reorder level.</div>}
        </div>
      </div>
      <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-4">
        <h3 className="font-bold text-sm mb-2">Dead stock ≥90d ({dead.length}) + closings</h3>
        <div className="space-y-2 max-h-[200px] overflow-auto mb-3">
          {dead.map((r) => <div key={r.id} className="flex justify-between text-sm"><span className="font-mono">{r.sku} <span className="font-sans opacity-60">{r.deadDays}d · {r.onHand}{r.unit}</span></span><span className="font-bold">{inr(r.stockValue)}</span></div>)}
          {dead.length === 0 && <div className="text-sm opacity-60">No dead stock.</div>}
        </div>
        <h3 className="font-bold text-sm mb-2">Day-wise closings (top 10 by value)</h3>
        <div className="overflow-x-auto"><table className="w-full text-xs font-mono">
          <thead><tr className="opacity-60"><th className="text-left p-1">SKU</th>{days.slice(-7).map((d) => <th key={d} className="p-1">{d.slice(5)}</th>)}</tr></thead>
          <tbody>{[...items].filter((r) => r.active).sort((a, b) => b.stockValue - a.stockValue).slice(0, 10).map((r) => (
            <tr key={r.id} className="border-t border-[var(--border-card)]"><td className="p-1">{r.sku}</td>{days.slice(-7).map((d) => <td key={d} className="p-1 text-right">{closings?.[r.id]?.[d] ?? 0}</td>)}</tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}
