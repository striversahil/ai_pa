"use client";
import React from "react";

export interface StockLine { id: string; sku: string; productName: string; category: string; brand: string; unit: string; reorderLevel: number; minLevel: number; maxLevel: number; avgDailyConsumption: number; leadTimeDays: number; safetyFactor: number; moq: number; purchaseRate: number; saleRate: number; supplier: string; onHand: number; reserved: number; available: number; avgRate: number; stockValue: number; pendingToOrder: number; status: 'out' | 'low' | 'ok'; abc: 'A' | 'B' | 'C'; lastMoveDay: string; deadDays: number; }

export function statusPill(s: StockLine['status']) {
  if (s === 'out') return <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-red-500/10 text-red-400 border border-red-500/20">OUT</span>;
  if (s === 'low') return <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">LOW</span>;
  return <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">OK</span>;
}

export function abcBadge(a: string) {
  const c = a === 'A' ? 'text-red-300 border-red-500/30 bg-red-500/10' : a === 'B' ? 'text-amber-300 border-amber-500/30 bg-amber-500/10' : 'text-zinc-400 border-zinc-500/30 bg-zinc-500/10';
  return <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${c}`}>{a}</span>;
}

export const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
