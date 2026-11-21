// crm/CancelDialog.tsx — one Cancel surface for the dispatch floor.
//
// Unifies the old "Cancel items" + "Cancel SO" buttons: scope radio (Whole SO
// vs Selected lines), per-line checkboxes + cancel-qty inputs defaulting to
// the full remaining balance (edit down for a partial qty), one
// client-confirmation reason. Full remainder removes the line; partial qty
// shrinks the floor overlay and leaves the line open.
"use client";

import { useMemo, useState } from "react";
import { crmApi } from "./api";
import { effectiveQty, validateCancelItems, validateLocalCancel } from "./lifecycle";
import type { CrmOrder } from "./types";
import { ReasonBox } from "./order-panel/ReasonBox";

export default function CancelDialog({
  order,
  onClose,
  onDone,
}: {
  order: CrmOrder;
  onClose: () => void;
  onDone: () => void;
}) {
  const items = order.items || [];
  const open = items.filter((it) => !(it as any).removedAt);
  const [scope, setScope] = useState<"lines" | "whole">("lines");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingOf = (id: string) => {
    const it = items.find((i) => i.id === id);
    if (!it) return 0;
    return Math.max(0, effectiveQty(it as any) - (Number(it.dispatchedQty) || 0));
  };

  const entries = useMemo(
    () =>
      [...picked].map((itemId) => {
        const raw = (qty[itemId] ?? "").trim();
        return { itemId, qty: raw === "" ? null : Number(raw) };
      }),
    [picked, qty],
  );

  const linesCheck = useMemo(() => {
    if (scope !== "lines") return { ok: true as const };
    return validateCancelItems({ items: items as any, entries, reason });
  }, [scope, items, entries, reason]);

  const wholeCheck = useMemo(() => {
    if (scope !== "whole") return { ok: true as const };
    return validateLocalCancel({
      reason,
      order: { status: order.status, orderStatus: (order as any).orderStatus },
      localCancelledAt: (order as any).localCancelledAt,
    });
  }, [scope, reason, order]);

  const save = async () => {
    if (scope === "whole") {
      if (!wholeCheck.ok) {
        setError((wholeCheck as any).message);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await crmApi.cancelLocal(order.id, reason.trim());
        onDone();
      } catch (e: any) {
        setError(String(e?.message || e));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!linesCheck.ok) {
      setError((linesCheck as any).message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await crmApi.cancelItems(order.id, entries, reason.trim());
      onDone();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3">
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
        Cancel — unavailable stock
      </h3>
      <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="radio"
            checked={scope === "lines"}
            onChange={() => setScope("lines")}
            className="h-3.5 w-3.5 accent-amber-600"
          />
          Selected lines
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="radio"
            checked={scope === "whole"}
            onChange={() => setScope("whole")}
            className="h-3.5 w-3.5 accent-rose-600"
          />
          Whole SO
        </label>
      </div>

      {scope === "whole" ? (
        <p className="mt-2 text-[11px] text-zinc-600 dark:text-zinc-300">
          The whole SO leaves the floor. Logged with your reason; only root can reopen.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[11px] text-zinc-600 dark:text-zinc-300">
            Tick lines and edit the qty to cancel less than the balance (blank = full remaining).
            Partial qty leaves the line open; full remainder removes it. Fully dispatched lines are locked.
          </p>
          <div className="mt-2 space-y-1.5">
            {open.map((it) => {
              const eff = effectiveQty(it as any);
              const dispatched = Number(it.dispatchedQty) || 0;
              const remaining = Math.max(0, eff - dispatched);
              const locked = remaining <= 1e-6;
              return (
                <div
                  key={it.id}
                  className={`flex flex-wrap items-center gap-2 rounded-lg bg-white/70 px-2 py-1.5 text-xs dark:bg-zinc-900/60 ${locked ? "opacity-50" : ""}`}
                >
                  <label className={`flex min-w-0 flex-1 items-center gap-2 ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={picked.has(it.id)}
                      onChange={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (next.has(it.id)) next.delete(it.id);
                          else next.add(it.id);
                          return next;
                        })
                      }
                      className="h-3.5 w-3.5 rounded border-zinc-300 accent-amber-600 disabled:opacity-30"
                    />
                    <span className="min-w-0 flex-1 font-medium text-zinc-800 dark:text-zinc-100">
                      {it.name || it.description || it.sku || "—"}
                      <span className="ml-1 text-[10px] text-zinc-400">
                        {dispatched > 0 ? `${dispatched} out · ` : ""}
                        {remaining} left{it.unit ? ` ${it.unit}` : ""}
                      </span>
                    </span>
                  </label>
                  {picked.has(it.id) && !locked && (
                    <label className="flex items-center gap-1 text-[11px] text-zinc-600 dark:text-zinc-300">
                      Cancel
                      <input
                        type="number"
                        min={0}
                        step="any"
                        max={remaining}
                        placeholder={String(remaining)}
                        value={qty[it.id] ?? ""}
                        onChange={(e) => setQty((p) => ({ ...p, [it.id]: e.target.value }))}
                        className="w-24 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-amber-500 dark:border-zinc-700 dark:bg-zinc-950"
                      />
                    </label>
                  )}
                </div>
              );
            })}
            {open.length === 0 && (
              <p className="text-xs italic text-zinc-400">No open lines — every line was removed earlier.</p>
            )}
          </div>
        </>
      )}

      <div className="mt-2">
        <ReasonBox label="Cancellation reason" value={reason} onChange={setReason} />
      </div>
      {scope === "lines" && !linesCheck.ok && (
        <p className="mt-2 text-[11px] font-bold text-amber-600 dark:text-amber-400">{(linesCheck as any).message}</p>
      )}
      {scope === "whole" && !wholeCheck.ok && (
        <p className="mt-2 text-[11px] font-bold text-amber-600 dark:text-amber-400">{(wholeCheck as any).message}</p>
      )}
      {error && <p className="mt-2 text-[11px] font-bold text-rose-500">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300"
        >
          Keep
        </button>
        <button
          onClick={() => { void save(); }}
          disabled={busy || (scope === "lines" ? !linesCheck.ok : !wholeCheck.ok)}
          className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-800"
        >
          {busy ? "Cancelling…" : scope === "whole" ? "Cancel SO" : "Cancel selected"}
        </button>
      </div>
      {picked.size > 0 && scope === "lines" && (
        <p className="mt-1 text-right text-[10px] text-zinc-400">
          Full remainder ({[...picked].filter((id) => (qty[id] ?? "").trim() === "").length}) removes the line; edited qty shrinks it.
        </p>
      )}
    </div>
  );
}
