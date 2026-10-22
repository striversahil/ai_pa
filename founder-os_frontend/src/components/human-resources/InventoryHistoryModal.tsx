"use client";

import React, { useCallback, useEffect, useState } from "react";
import Modal from "../Modal";
import ConfirmDialog from "../ui/ConfirmDialog";
import { INVENTORY_TXN_LABEL, type HrInventoryItem, type HrInventoryTxn } from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";
import { dateLabel, qty } from "@/hr/format";

function signedQty(t: HrInventoryTxn, unit: string): string {
  const n = Number(t.quantity) || 0;
  if (t.txnType === "consumption") return `−${qty(Math.abs(n), unit)}`;
  if (t.txnType === "adjustment") return `${n >= 0 ? "+" : "−"}${qty(Math.abs(n), unit)}`;
  return `+${qty(Math.abs(n), unit)}`;
}

export default function InventoryHistoryModal({ item, canManage, onClose, onChanged }: {
  item: HrInventoryItem;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [txns, setTxns] = useState<HrInventoryTxn[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<HrInventoryTxn | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const res = await fetch(`/api/human-resources/inventory/items/${item.id}/transactions`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      const body = await res.json();
      setTxns(Array.isArray(body.transactions) ? body.transactions : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
      setTxns([]);
    }
  }, [item.id]);

  useEffect(() => { void load(); }, [load]);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true); setErr(null);
    try {
      const res = await jsonRequest(`/api/human-resources/inventory/transactions/${deleting.id}`, "DELETE");
      if (!res.ok) throw new Error(await readError(res));
      setDeleting(null);
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally { setBusy(false); }
  };

  return (
    <>
      <Modal title={`Stock history · ${item.name}`} subtitle={`Current stock: ${qty(item.currentQty, item.unit)}`} onClose={onClose} wide>
        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
        {txns === null && <div className="py-8 text-center text-xs text-zinc-500 animate-pulse">Loading history…</div>}
        {txns?.length === 0 && <div className="py-8 text-center text-xs text-zinc-500">No stock movements yet.</div>}
        <div className="space-y-2">
          {txns?.map((t) => (
            <div key={t.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${t.txnType === "consumption" ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" : t.txnType === "adjustment" ? "border-rose-500/30 bg-rose-500/10 text-rose-500" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}`}>
                      {INVENTORY_TXN_LABEL[t.txnType]}
                    </span>
                    <span className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">{signedQty(t, item.unit)}</span>
                    <span className="text-[11px] text-zinc-500">{dateLabel(t.txnDate)}</span>
                    {t.expenseId && <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-500 dark:text-indigo-400">Expense linked</span>}
                  </div>
                  {t.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-500 dark:text-zinc-400">{t.notes}</p>}
                  {t.createdBy && <p className="mt-1 text-[10px] text-zinc-400">by {t.createdBy}</p>}
                </div>
                {canManage && (
                  <button onClick={() => setDeleting(t)} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10">Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete stock movement?"
        message={<>Delete this {deleting ? INVENTORY_TXN_LABEL[deleting.txnType].toLowerCase() : "movement"} of <b>{deleting ? signedQty(deleting, item.unit) : ""}</b>? Any expense created with it will also be removed.</>}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
