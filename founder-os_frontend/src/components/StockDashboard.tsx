"use client";

import React, { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { TabBar } from "@/components/ui/TabBar";
import InventoryTable from "./stock/InventoryTable";
import AlertsReports from "./stock/AlertsReports";
import { inr } from "./stock/shared";

interface Payload { meta: { analysis: string; generatedAt: string; day: string; days: string[]; locations: { id: string; name: string }[]; planning?: { leadTimeDays: number; safetyFactor: number; moq: number; source: string } }; items: any[]; closings: Record<string, Record<string, number>>; totals: { skus: number; units: number; available: number; value: number; low: number; out: number; dead: number; pendingAdjust: number; pendingToOrder: number }; movements: any[]; }

const panel = "bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl";
const field = "w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none text-sm text-[var(--text-primary)]";
const primaryBtn = "inline-flex items-center gap-1.5 px-3.5 py-2 bg-brand-indigo text-white font-bold text-xs rounded-xl hover:opacity-90 disabled:opacity-40 cursor-pointer border-0";
const ghostBtn = "inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border-card)] hover:bg-[var(--bg-input)] font-bold text-xs rounded-xl cursor-pointer bg-transparent text-[var(--text-primary)]";

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(String((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`));
  return res.json().catch(() => ({}));
}

export default function StockDashboard() {
  const dash = useLiveDashboard<Payload>(async () => {
    const res = await fetch("/api/automations/stock/data?days=14");
    if (!res.ok) throw new Error("load failed");
    return res.json();
  });
  const [tab, setTab] = useState<'inv' | 'moves' | 'alerts' | 'add'>('inv');
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ productName: "", category: "", brand: "", unit: "pcs", purchaseRate: "", saleRate: "", supplier: "", reorderLevel: "", maxLevel: "" });
  const [mv, setMv] = useState({ itemId: "", kind: "purchase-in", qty: "", day: new Date().toISOString().slice(0, 10), locationId: "", toLocationId: "", rate: "", note: "", refId: "" });

  const data = dash.data;
  const cats = useMemo(() => [...new Set((data?.items ?? []).map((r) => String(r.category || "")).filter(Boolean))].sort(), [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.items ?? []).filter((r) => r.active)
      .filter((r) => !cat || String(r.category) === cat)
      .filter((r) => !onlyLow || r.status !== 'ok')
      .filter((r) => !needle || r.sku.toLowerCase().includes(needle) || String(r.productName).toLowerCase().includes(needle) || String(r.brand).toLowerCase().includes(needle))
      .sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
  }, [data, q, cat, onlyLow]);

  if (dash.loading) return <div className="py-20 text-center text-sm opacity-60 animate-pulse">Loading stock…</div>;
  if (dash.error) return <div className="py-20 text-center text-sm text-red-400">Stock failed to load — <button className={ghostBtn} onClick={() => dash.refresh()}>Retry</button></div>;
  const days = data?.meta.days ?? [];
  const locs = data?.meta.locations ?? [];
  const tabs = [
    { key: 'inv' as const, label: 'Inventory', icon: '📦', count: data?.totals.skus ?? null },
    { key: 'moves' as const, label: 'Movements', icon: '🔄', count: (data?.movements ?? []).length || null },
    { key: 'alerts' as const, label: 'Alerts & Reports', icon: '⚠️', count: (data?.totals.low ?? 0) + (data?.totals.out ?? 0) || null, tone: 'danger' as const },
    { key: 'add' as const, label: 'Add item', icon: '➕' },
  ];

  const downloadCsv = () => {
    const header = ["SKU", "Product", "Category", "Brand", "Unit", "OnHand", "Reserved", "Available", "AvgDailyConsumption", "MaxLevel", "PendingToOrder", "AvgRate", "StockValue", "Reorder", "Status", "ABC"];
    const lines = [header.join(",")];
    for (const r of rows) {
      const cells = [r.sku, r.productName, r.category, r.brand, r.unit, r.onHand, r.reserved, r.available, r.avgDailyConsumption ?? 0, r.maxLevel ?? 0, r.pendingToOrder ?? 0, r.avgRate, r.stockValue, r.reorderLevel, r.status, r.abc];
      lines.push(cells.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stock-${data?.meta.day ?? 'today'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const addItem = async () => {
    setErr(""); setBusy(true);
    try {
      const body = { ...form, purchaseRate: Number(form.purchaseRate) || 0, saleRate: Number(form.saleRate) || 0, reorderLevel: Number(form.reorderLevel) || 0, maxLevel: Number(form.maxLevel) || 0 };
      const row = await api("/api/stock/items", "POST", body);
      setForm({ productName: "", category: "", brand: "", unit: "pcs", purchaseRate: "", saleRate: "", supplier: "", reorderLevel: "", maxLevel: "" });
      setTab('inv'); dash.refresh();
      alert(`SKU created: ${row.sku}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const postMv = async () => {
    setErr(""); setBusy(true);
    try {
      await api("/api/stock/movements", "POST", { ...mv, qty: Number(mv.qty), rate: Number(mv.rate) || 0 });
      setMv({ ...mv, qty: "", note: "", refId: "" }); dash.refresh();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-6 text-zinc-900 md:px-8 dark:text-zinc-100">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stock</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Auto-SKU inventory — on-hand vs available, moving-average value, transfers, reservations and day-wise closings.
            {data?.meta.planning && <span className="ml-1 opacity-80">Planning: lead {data.meta.planning.leadTimeDays}d · safety ×{data.meta.planning.safetyFactor} · MOQ {data.meta.planning.moq}m (SEFAR backfill).</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && (
            <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live · {data.meta.day}
            </div>
          )}
          <button
            onClick={downloadCsv}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500"
          >
            ⬇ Export CSV
          </button>
          <button
            onClick={() => dash.refresh()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${dash.loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      <div className="w-full shrink-0">
        <TabBar items={tabs} active={tab} onChange={setTab} />
      </div>

      {err && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          <span>{err}</span>
          <button onClick={() => setErr("")} className="rounded-lg border border-rose-300 px-3 py-1 text-xs font-medium hover:bg-rose-100 dark:border-rose-800 dark:hover:bg-rose-950/50">Dismiss</button>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
        {[["SKUs", String(data?.totals.skus ?? 0)], ["On-hand", String(data?.totals.units ?? 0)], ["Value", inr(data?.totals.value ?? 0)], ["To order", `${(data?.totals.pendingToOrder ?? 0).toLocaleString('en-IN')} m`], ["Low", String(data?.totals.low ?? 0)], ["Out", String(data?.totals.out ?? 0)], ["Dead 90d", String(data?.totals.dead ?? 0)]].map(([l, v]) => (
          <div key={l} className={`${panel} p-4`}><div className="text-[11px] uppercase tracking-wider opacity-60">{l}</div><div className="text-xl font-bold">{v}</div></div>
        ))}
      </div>
      {(data?.totals.pendingAdjust ?? 0) > 0 && <div className="text-xs text-amber-300">{data?.totals.pendingAdjust} adjustments awaiting approval (see Movements).</div>}
      {tab === 'inv' && (
        <div className={`${panel} p-2 flex gap-2 flex-wrap`}>
          <input className={field} style={{ maxWidth: 220 }} placeholder="Search SKU / product / brand…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className={field} style={{ maxWidth: 160 }} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <button className={ghostBtn} onClick={() => setOnlyLow(!onlyLow)}>{onlyLow ? "✓ Needs reorder" : "Needs reorder"}</button>
        </div>
      )}
      {tab === 'inv' && <InventoryTable rows={rows} closings={data?.closings ?? {}} days={days} onPick={() => {}} />}
      {tab === 'alerts' && <AlertsReports items={data?.items ?? []} closings={data?.closings ?? {}} days={days} />}
      {tab === 'moves' && (
        <div className="grid lg:grid-cols-[320px_1fr] gap-4">
          <div className={`${panel} p-4 space-y-2 h-fit`}>
            <h3 className="font-bold text-sm">Post movement</h3>
            <select className={field} value={mv.itemId} onChange={(e) => setMv({ ...mv, itemId: e.target.value })}>
              <option value="">Select SKU…</option>{(data?.items ?? []).filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.sku} — {r.productName} (av {r.available})</option>)}
            </select>
            <div className="flex gap-2">
              <select className={field} value={mv.kind} onChange={(e) => setMv({ ...mv, kind: e.target.value })}>
                <option value="purchase-in">Purchase-in (+)</option><option value="sales-out">Sales-out (−)</option><option value="transfer">Transfer</option><option value="adjustment">Adjustment (±, needs approval)</option><option value="opening">Opening (+)</option>
              </select>
              <input className={field} placeholder="Qty" value={mv.qty} onChange={(e) => setMv({ ...mv, qty: e.target.value })} inputMode="decimal" />
            </div>
            <div className="flex gap-2">
              <select className={field} value={mv.locationId} onChange={(e) => setMv({ ...mv, locationId: e.target.value })}>
                <option value="">Location (default MAIN)</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              {mv.kind === 'transfer' && <select className={field} value={mv.toLocationId} onChange={(e) => setMv({ ...mv, toLocationId: e.target.value })}><option value="">To…</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
            </div>
            <div className="flex gap-2">
              <input className={field} type="date" value={mv.day} onChange={(e) => setMv({ ...mv, day: e.target.value })} />
              <input className={field} placeholder="Rate" value={mv.rate} onChange={(e) => setMv({ ...mv, rate: e.target.value })} inputMode="decimal" />
            </div>
            <input className={field} placeholder="SO / PO ref (optional)" value={mv.refId} onChange={(e) => setMv({ ...mv, refId: e.target.value })} />
            <input className={field} placeholder="Note" value={mv.note} onChange={(e) => setMv({ ...mv, note: e.target.value })} />
            <button className={primaryBtn} disabled={busy || !mv.itemId || !mv.qty} onClick={postMv}>Save movement</button>
            <div className="text-[11px] opacity-60">Sales-out always reduces stock; purchase-in/opening always adds; adjustments enter as pending until approved.</div>
          </div>
          <div className={`${panel} p-4`}>
            <h3 className="font-bold text-sm mb-2">Ledger (latest 300)</h3>
            <div className="space-y-1.5 max-h-[560px] overflow-auto text-sm">
              {(data?.movements ?? []).map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 border-b border-[var(--border-card)] pb-1.5">
                  <div><span className="font-mono font-bold">{m.kind}</span> <span className="font-mono">{m.qty > 0 ? "+" : ""}{m.qty}</span> <span className="opacity-60 text-xs">{m.day} · {m.note} {m.refId ? `· ${m.refId}` : ""}</span>
                    {m.status === 'pending' && <span className="ml-2 text-[10px] font-bold text-amber-300 border border-amber-500/30 rounded px-1">PENDING</span>}</div>
                  {m.status === 'pending' && <button className={ghostBtn} onClick={async () => { await api(`/api/stock/movements/${m.id}/approve`, "POST"); dash.refresh(); }}>Approve</button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {tab === 'add' && (
        <div className={`${panel} p-4 grid md:grid-cols-2 gap-2 max-w-3xl`}>
          <div className="md:col-span-2 text-sm opacity-70">SKU is <b>auto-generated</b> as <span className="font-mono">CAT-0007</span> from the category + a running sequence. You only enter the product details.</div>
          <input className={field} placeholder="Product name *" value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} />
          <input className={field} placeholder="Category (e.g. PANEL)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input className={field} placeholder="Brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
          <input className={field} placeholder="Unit (pcs)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          <input className={field} placeholder="Purchase rate" value={form.purchaseRate} onChange={(e) => setForm({ ...form, purchaseRate: e.target.value })} inputMode="decimal" />
          <input className={field} placeholder="Sale rate" value={form.saleRate} onChange={(e) => setForm({ ...form, saleRate: e.target.value })} inputMode="decimal" />
          <input className={field} placeholder="Supplier" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
          <input className={field} placeholder="Reorder level" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} inputMode="decimal" />
          <input className={field} placeholder="Max level (PO fill-to)" value={form.maxLevel} onChange={(e) => setForm({ ...form, maxLevel: e.target.value })} inputMode="decimal" />
          <div><button className={primaryBtn} disabled={busy || !form.productName.trim()} onClick={addItem}>Create item + auto-SKU</button></div>
        </div>
      )}
    </div>
  );
}
