"use client";

// CategoryManager.tsx — add, rename and remove categories.
//
// Categories normally appear when a product uses them; this drawer is for the
// other two orders of work: declare one before any product is filed under it,
// and rename one everywhere (founder decision 2026-11-23 — a rename is a bulk
// update, not a new category). Deleting is allowed only while nothing uses it.
import React, { useMemo, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { ConfirmDialog, Drawer } from "@/components/ui";
import { field, ghostBtn, iconBtn, label, primaryBtn } from "../product-line-dashboard/helpers";
import { hueFor } from "../product-line-dashboard/helpers";
import { productLineApi } from "@/product-line/api";
import type { KypProduct } from "@/product-line/types";

const errMsg = (e: unknown) => String((e as any)?.message ?? "request failed");

interface Props {
  categories: string[];
  products: KypProduct[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}

export function CategoryManager({ categories, products, canEdit, onClose, onChanged }: Props) {
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmCat, setConfirmCat] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) map.set(p.category, (map.get(p.category) ?? 0) + 1);
    return map;
  }, [products]);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      await fn();
      onChanged();
      setNote(success);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    void run(async () => {
      await productLineApi.addCategory(name);
      setNewName("");
    }, `Added "${name}"`);
  };

  const rename = (from: string) => {
    const to = editValue.trim();
    if (!to || to === from) { setEditing(null); return; }
    void run(async () => {
      const out = await productLineApi.renameCategory(from, to);
      setEditing(null);
      setNote(`Renamed "${from}" → "${to}" on ${(out as any)?.updated ?? 0} product(s)`);
    }, "");
  };

  const remove = (name: string) => {
    void run(async () => {
      await productLineApi.deleteCategory(name);
    }, `Removed "${name}"`);
  };

  return (
    <Drawer
      title="Categories"
      subtitle={`${categories.length} categories · ${products.length} products`}
      onClose={onClose}
      width="max-w-xl"
    >
      <div className="space-y-3">
        {canEdit ? (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <span className={label}>New category</span>
              <input
                className={field}
                placeholder="e.g. bucket_elevator_accessories"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              />
            </div>
            <button type="button" className={primaryBtn} disabled={busy || !newName.trim()} onClick={add}>
              <Plus size={13} /> Add
            </button>
          </div>
        ) : null}

        {err ? <div className="text-xs font-semibold text-[var(--color-danger)] bg-[var(--bg-input)] rounded-xl px-3 py-2">{err}</div> : null}
        {note ? <div className="text-xs font-semibold text-emerald-600 bg-[var(--bg-input)] rounded-xl px-3 py-2">{note}</div> : null}

        <div className="divide-y divide-[var(--border-card)]/60 border border-[var(--border-card)] rounded-xl overflow-hidden">
          {categories.map((c) => {
            const used = counts.get(c) ?? 0;
            const isEditing = editing === c;
            return (
              <div key={c} className="flex items-center gap-2 px-3 py-2">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: hueFor(c) }} />
                {isEditing ? (
                  <>
                    <input
                      autoFocus
                      className={`${field} h-8`}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") rename(c);
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                    <button type="button" className={iconBtn} title="Save rename" disabled={busy} onClick={() => rename(c)}>
                      <Check size={14} className="text-emerald-500" />
                    </button>
                    <button type="button" className={iconBtn} title="Cancel" onClick={() => setEditing(null)}>
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12px] font-bold text-[var(--text-primary)] truncate">{c}</span>
                      <span className="block text-[10px] text-[var(--text-tertiary)]">
                        {used ? `${used} product${used === 1 ? "" : "s"}` : "no products yet"}
                      </span>
                    </span>
                    {canEdit ? (
                      <>
                        <button
                          type="button"
                          className={iconBtn}
                          title="Rename everywhere"
                          onClick={() => { setEditing(c); setEditValue(c); setErr(null); }}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className={iconBtn}
                          title={used ? "Move its products first" : "Remove category"}
                          disabled={busy || used > 0}
                          onClick={() => setConfirmCat(c)}
                        >
                          <Trash2 size={13} className={used ? "opacity-40" : ""} />
                        </button>
                      </>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
          {!categories.length ? (
            <div className="px-3 py-8 text-center text-xs text-[var(--text-tertiary)]">No categories yet.</div>
          ) : null}
        </div>

        <p className="text-[10px] text-[var(--text-tertiary)]">
          Renaming updates every product in one write. A category with products cannot be deleted — move them
          first, or rename it.
        </p>
        <div className="flex justify-end">
          <button type="button" className={ghostBtn} onClick={onClose}>Done</button>
        </div>

        <ConfirmDialog
          open={!!confirmCat}
          title="Remove this category?"
          message={
            <>
              <b>{confirmCat}</b> disappears from the category pickers. It is only removed while no product uses it —
              otherwise the server refuses and tells you how many products to move first.
            </>
          }
          confirmLabel="Remove category"
          busy={busy}
          onConfirm={() => {
            const c = confirmCat;
            setConfirmCat(null);
            if (c) remove(c);
          }}
          onCancel={() => setConfirmCat(null)}
        />
      </div>
    </Drawer>
  );
}
