"use client";

import React, { useMemo, useState } from "react";
import ConfirmDialog from "../ui/ConfirmDialog";
import InventoryItemModal from "./InventoryItemModal";
import StockMoveModal from "./StockMoveModal";
import InventoryHistoryModal from "./InventoryHistoryModal";
import type { HrDashboardData, HrInventoryItem, InventoryMoveType } from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";
import { money, qty } from "@/hr/format";

type StockFilter = "all" | "low" | "out";

function SummaryCard({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2.5">
      <div className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-lg font-extrabold ${tone}`}>{value}</div>
      <div className="text-[10px] text-zinc-500">{hint}</div>
    </div>
  );
}

function ItemCard({ item, canManage, onMove, onHistory, onEdit, onDelete }: {
  item: HrInventoryItem;
  canManage: boolean;
  onMove: (item: HrInventoryItem, mode: InventoryMoveType) => void;
  onHistory: (item: HrInventoryItem) => void;
  onEdit: (item: HrInventoryItem) => void;
  onDelete: (item: HrInventoryItem) => void;
}) {
  const badge = item.outOfStock
    ? "border-rose-500/30 bg-rose-500/10 text-rose-500"
    : item.lowStock
      ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  return (
    <div className={`rounded-xl border bg-white dark:bg-zinc-950 p-3 ${item.outOfStock ? "border-rose-500/40" : item.lowStock ? "border-amber-500/40" : "border-zinc-200 dark:border-zinc-800"}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{item.name}</h4>
            {item.category && <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">{item.category}</span>}
            {(item.lowStock || item.outOfStock) && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${badge}`}>{item.outOfStock ? "Out of stock" : "Low stock"}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-end gap-x-3 gap-y-1">
            <span className="text-xl font-extrabold text-zinc-900 dark:text-zinc-100">{qty(item.currentQty, item.unit)}</span>
            <span className="text-[11px] text-zinc-500">reorder at {qty(item.reorderLevel, item.unit)}</span>
            {item.stockValue != null && <span className="text-[11px] font-semibold text-zinc-500">value {money(item.stockValue)}</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
            <span>In this month: <b className="text-emerald-600 dark:text-emerald-400">{qty(item.purchasedThisMonth, item.unit)}</b></span>
            <span>Used this month: <b className="text-amber-600 dark:text-amber-400">{qty(item.consumedThisMonth, item.unit)}</b></span>
            {item.unitCost != null && <span>@ {money(item.unitCost)} / {item.unit}</span>}
          </div>
          {item.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-500 dark:text-zinc-400">{item.notes}</p>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button onClick={() => onMove(item, "purchase")} className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1.5 text-[11px] font-bold text-white">Stock in</button>
        <button onClick={() => onMove(item, "consumption")} disabled={item.outOfStock} className="rounded-lg bg-amber-500 hover:bg-amber-400 px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-40">Use</button>
        <button onClick={() => onHistory(item)} className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1.5 text-[11px] font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700">History</button>
        {canManage && (
          <>
            <button onClick={() => onMove(item, "adjustment")} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Adjust</button>
            <button onClick={() => onEdit(item)} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-indigo-500 hover:bg-indigo-500/10">Edit</button>
            <button onClick={() => onDelete(item)} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10">Delete</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function InventoryTab({ data, canManage, onRefresh }: {
  data: HrDashboardData;
  canManage: boolean;
  onRefresh: () => void;
}) {
  const inventory = data.inventory;
  const [filter, setFilter] = useState<StockFilter>("all");
  const [itemForm, setItemForm] = useState<{ open: boolean; item: HrInventoryItem | null }>({ open: false, item: null });
  const [move, setMove] = useState<{ item: HrInventoryItem; mode: InventoryMoveType } | null>(null);
  const [history, setHistory] = useState<HrInventoryItem | null>(null);
  const [deleting, setDeleting] = useState<HrInventoryItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const items = useMemo(() => {
    if (filter === "low") return inventory.items.filter((i) => i.lowStock && !i.outOfStock);
    if (filter === "out") return inventory.items.filter((i) => i.outOfStock);
    return inventory.items;
  }, [inventory.items, filter]);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true); setErr(null);
    try {
      const res = await jsonRequest(`/api/human-resources/inventory/items/${deleting.id}`, "DELETE");
      if (!res.ok) throw new Error(await readError(res));
      setDeleting(null);
      onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <SummaryCard label="Items" value={String(inventory.summary.itemCount)} hint="tracked daily-use items" tone="text-zinc-900 dark:text-zinc-100" />
        <SummaryCard label="Low stock" value={String(inventory.summary.lowStockCount)} hint="at or below reorder level" tone="text-amber-600 dark:text-amber-400" />
        <SummaryCard label="Out of stock" value={String(inventory.summary.outOfStockCount)} hint="needs restocking" tone="text-rose-500" />
        <SummaryCard label="Movements" value={String(inventory.summary.movementCount)} hint={`stock entries in ${inventory.month}`} tone="text-sky-600 dark:text-sky-400" />
        <SummaryCard label="Stock value" value={money(inventory.summary.stockValue)} hint="where unit cost is set" tone="text-emerald-600 dark:text-emerald-400" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {([
            { key: "all" as const, label: `All (${inventory.items.length})` },
            { key: "low" as const, label: `Low (${inventory.items.filter((i) => i.lowStock && !i.outOfStock).length})` },
            { key: "out" as const, label: `Out (${inventory.items.filter((i) => i.outOfStock).length})` },
          ]).map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${filter === f.key ? "border-transparent bg-indigo-600 text-white" : "border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
              {f.label}
            </button>
          ))}
        </div>
        {canManage && (
          <button onClick={() => setItemForm({ open: true, item: null })} className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-bold text-white">Add item</button>
        )}
      </div>

      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}

      {inventory.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 px-3 py-10 text-center text-xs text-zinc-500">
          No inventory items yet. {canManage ? "Add a daily-use item to start tracking stock." : "Ask an MIS user to add inventory items."}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 px-3 py-10 text-center text-xs text-zinc-500">No items in this filter.</div>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              canManage={canManage}
              onMove={(i, mode) => setMove({ item: i, mode })}
              onHistory={setHistory}
              onEdit={(i) => setItemForm({ open: true, item: i })}
              onDelete={setDeleting}
            />
          ))}
        </div>
      )}

      {itemForm.open && (
        <InventoryItemModal
          item={itemForm.item}
          onClose={() => setItemForm({ open: false, item: null })}
          onSaved={onRefresh}
        />
      )}
      {move && (
        <StockMoveModal
          item={move.item}
          mode={move.mode}
          onClose={() => setMove(null)}
          onSaved={onRefresh}
        />
      )}
      {history && (
        <InventoryHistoryModal
          item={history}
          canManage={canManage}
          onClose={() => setHistory(null)}
          onChanged={onRefresh}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete inventory item?"
        message={<>Delete <b>{deleting?.name}</b>? Its stock history is kept but the item will stop appearing in the list.</>}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
