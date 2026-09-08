"use client";

import React from "react";
import { useLiveQuery } from "@/hooks/useLiveData";
import { PackageCheck, FileCheck, Truck, CreditCard, CheckCircle2, RefreshCw } from "lucide-react";

const PROCESS_META: Record<string, { label: string; icon: React.ElementType; accent: string; desc: string }> = {
  confirm:   { label: "Confirm",   icon: FileCheck,    accent: "text-amber-400 bg-amber-500/10 border-amber-500/30", desc: "Draft — needs confirmation" },
  invoice:   { label: "Invoice",   icon: PackageCheck, accent: "text-sky-400 bg-sky-500/10 border-sky-500/30", desc: "Confirmed — needs invoicing" },
  ship:      { label: "Ship",      icon: Truck,        accent: "text-indigo-400 bg-indigo-500/10 border-indigo-500/30", desc: "Invoiced — needs shipping" },
  payment:   { label: "Payment",   icon: CreditCard,   accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30", desc: "Shipped — awaiting payment" },
};

const STEP_ORDER = ["confirm", "invoice", "ship", "payment"];

export default function CrmDashboard() {
  const crm = useLiveQuery<any>(
    async () => {
      const res = await fetch("/api/automations/crm/data");
      if (!res.ok) throw new Error("load failed");
      return res.json();
    },
    { events: ["automation"] },
  );

  const data = crm.data;
  const byProcess = data?.byProcess || {};
  const totalActive = data?.totalActive || 0;
  const totalValue = data?.totalValue || 0;
  const fresh = data?.fresh !== false;
  const computedAt = data?.computedAt ? new Date(data.computedAt).toLocaleString() : null;

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">CRM — Active Sales Orders</span>
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Open Zoho Books sales orders grouped by the next pending process step. Auto-refreshes every 15 minutes.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          {fresh ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
          {computedAt ? `Updated ${computedAt}` : "Loading…"}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-2xl border border-white/10 bg-[#111726]/80 p-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">Active SOs</span>
          <span className="text-2xl font-extrabold text-white">{totalActive.toLocaleString()}</span>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#111726]/80 p-4">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">Pipeline Value</span>
          <span className="text-2xl font-extrabold text-emerald-400">₹{totalValue.toLocaleString()}</span>
        </div>
        {STEP_ORDER.map((step) => {
          const meta = PROCESS_META[step];
          const Icon = meta?.icon || CheckCircle2;
          const count = byProcess[step]?.count || 0;
          const value = byProcess[step]?.value || 0;
          return (
            <div key={step} className="rounded-2xl border border-white/10 bg-[#111726]/80 p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">{meta?.label || step}</span>
              </div>
              <span className="text-2xl font-extrabold text-white">{count}</span>
              <span className="text-[10px] text-zinc-500 block">₹{value.toLocaleString()}</span>
            </div>
          );
        })}
      </div>

      {/* Process columns */}
      <div className="space-y-4">
        {STEP_ORDER.map((step) => {
          const meta = PROCESS_META[step];
          const Icon = meta?.icon || CheckCircle2;
          const group = byProcess[step];
          const orders = group?.orders || [];
          if (!group || group.count === 0) return null;
          return (
            <div key={step} className="bg-zinc-50/30 dark:bg-zinc-950/30 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-zinc-200/60 dark:border-zinc-800/60">
                <div className="flex items-center gap-2">
                  <span className={`w-7 h-7 rounded-lg border flex items-center justify-center ${meta?.accent}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-900 dark:text-white">{meta?.label}</h4>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{meta?.desc}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-lg font-extrabold text-white">{group.count}</span>
                  <span className="text-[10px] text-zinc-500 block">₹{group.value.toLocaleString()}</span>
                </div>
              </div>
              {orders.length > 0 ? (
                <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1 scrollbar-thin">
                  {orders.map((o: any, idx: number) => (
                    <div key={o.so || idx} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 px-2 rounded-lg hover:bg-zinc-100/40 dark:hover:bg-zinc-800/40 text-[11px]">
                      <span className={`px-1.5 py-0.5 text-[8px] rounded font-extrabold uppercase tracking-wide border ${meta?.accent}`}>{o.status || step}</span>
                      <span className="text-zinc-800 dark:text-zinc-200 font-mono font-bold">{o.so}</span>
                      {o.ref && <span className="text-zinc-500 dark:text-zinc-400 font-mono text-[10px]">↳ {o.ref}</span>}
                      <span className="text-zinc-800 dark:text-zinc-200 font-semibold truncate max-w-[160px]">{o.customer}</span>
                      {o.salesperson && <span className="text-zinc-500 dark:text-zinc-400 text-[10px]">{o.salesperson}</span>}
                      <span className="text-zinc-500 dark:text-zinc-400 font-mono ml-auto">₹{Number(o.total).toLocaleString()}</span>
                    </div>
                  ))}
                  {group.count > orders.length && (
                    <p className="text-[10px] text-zinc-500 italic py-1">…and {group.count - orders.length} more (showing first {orders.length})</p>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500 italic py-2">Counted {group.count} — detail loading on next refresh.</p>
              )}
            </div>
          );
        })}
      </div>

      {totalActive === 0 && fresh && (
        <div className="text-center py-12 text-zinc-500">
          <PackageCheck className="w-10 h-10 mx-auto mb-3 text-zinc-600" />
          <p className="text-sm">No active sales orders. Pipeline is clear!</p>
        </div>
      )}

      {!fresh && totalActive === 0 && (
        <div className="text-center py-12 text-zinc-500 animate-pulse">
          <RefreshCw className="w-10 h-10 mx-auto mb-3 text-zinc-600 animate-spin" />
          <p className="text-sm">Waiting for first CRM snapshot (every 15 min)…</p>
        </div>
      )}
    </div>
  );
}
