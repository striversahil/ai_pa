"use client";

// ProductEditor.tsx — one product, fully editable: label, category (with a
// rename-everywhere action), aliases (chips), active toggle and its spec ask.
// Everything here feeds the KYP JSON download; nothing is hand-typed elsewhere.
import React, { useMemo, useState } from "react";
import { Plus, Save, Tag, Trash2, X } from "lucide-react";
import { ConfirmDialog, Drawer } from "@/components/ui";
import { dangerBtn, field, ghostBtn, label, primaryBtn } from "../product-line-dashboard/helpers";
import { productLineApi } from "@/product-line/api";
import type { GuideRow, KypProduct } from "@/product-line/types";
import { SpecsEditor } from "./SpecsEditor";

const errMsg = (e: unknown) => String((e as any)?.message ?? "save failed");

interface Props {
  product: KypProduct;
  guide: GuideRow[];
  categories: string[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDelete: () => void;
}

export function ProductEditor({ product, guide, categories, canEdit, onClose, onChanged, onDelete }: Props) {
  const [name, setName] = useState(product.label);
  const [category, setCategory] = useState(product.category);
  const [aliases, setAliases] = useState<string[]>(product.aliases);
  const [aliasDraft, setAliasDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameTo, setRenameTo] = useState(product.category);

  const dirty = name !== product.label || category !== product.category ||
    aliases.join("|") !== product.aliases.join("|");

  const catOptions = useMemo(
    () => [...new Set([...categories, product.category])].sort(),
    [categories, product.category],
  );

  const addAlias = () => {
    const v = aliasDraft.trim();
    if (!v) return;
    if (!aliases.includes(v)) setAliases([...aliases, v]);
    setAliasDraft("");
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await productLineApi.updateProduct(product.id, {
        name: name.trim(),
        category,
        aliases,
      });
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const renameCategory = async () => {
    const to = renameTo.trim();
    if (!to || to === category) { setRenaming(false); return; }
    setBusy(true);
    setErr(null);
    try {
      const out = await productLineApi.renameCategory(category, to);
      setCategory(to);
      setRenaming(false);
      onChanged();
      setErr(`Renamed in ${out.updated} product${out.updated === 1 ? "" : "s"}.`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title={product.label}
      subtitle={<>key <span className="font-mono">{product.key}</span> · {guide.length} specs · {product.required.length} required</>}
      onClose={onClose}
      width="max-w-2xl"
    >
      <div className="space-y-4">
          {err ? (
            <div className="text-xs font-semibold text-[var(--color-danger)] bg-[var(--bg-input)] rounded-xl px-3 py-2">{err}</div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={label}>Product name</span>
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
            </div>
            <div>
              <span className={label}>Category</span>
              <div className="flex items-center gap-1.5">
                <select className={field} value={category} onChange={(e) => setCategory(e.target.value)} disabled={!canEdit}>
                  {catOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button type="button" className={ghostBtn} title="Rename this category on every product" disabled={!canEdit}
                  onClick={() => { setRenaming((v) => !v); setRenameTo(category); }}>
                  <Tag size={13} />
                </button>
              </div>
            </div>
          </div>

          {renaming ? (
            <div className="flex items-end gap-2 border border-dashed border-[var(--border-card)] rounded-xl p-2.5">
              <div className="flex-1">
                <span className={label}>Rename “{category}” to</span>
                <input className={field} value={renameTo} onChange={(e) => setRenameTo(e.target.value)} autoFocus />
              </div>
              <button type="button" className={primaryBtn} disabled={busy || !renameTo.trim()} onClick={() => void renameCategory()}>
                Rename everywhere
              </button>
            </div>
          ) : null}

          <div>
            <span className={label}>Aliases — Indian mandi / OEM names used for matching ({aliases.length})</span>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {aliases.map((a) => (
                <span key={a} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-lg bg-[var(--bg-input)] text-[11px] font-semibold text-[var(--text-secondary)]">
                  {a}
                  {canEdit ? (
                    <button type="button" className="opacity-60 hover:opacity-100" aria-label={`Remove ${a}`}
                      onClick={() => setAliases(aliases.filter((x) => x !== a))}>
                      <X size={11} />
                    </button>
                  ) : null}
                </span>
              ))}
              {!aliases.length ? <span className="text-[11px] text-[var(--text-tertiary)]">none yet</span> : null}
            </div>
            {canEdit ? (
              <div className="flex items-center gap-1.5 mt-2">
                <input
                  className={field}
                  placeholder="add an alias, e.g. Resham ki jali"
                  value={aliasDraft}
                  onChange={(e) => setAliasDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAlias(); } }}
                />
                <button type="button" className={ghostBtn} onClick={addAlias}><Plus size={13} /> Add</button>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2 border-t border-[var(--border-card)] pt-3">
            <button type="button" className={primaryBtn} disabled={!canEdit || busy || !dirty} onClick={() => void save()}>
              <Save size={13} /> Save product
            </button>
            <button type="button" className={ghostBtn} disabled={!dirty} onClick={() => {
              setName(product.label); setCategory(product.category); setAliases(product.aliases); setErr(null);
            }}>
              Reset
            </button>
            <button type="button" className={`${dangerBtn} ml-auto`} disabled={!canEdit} onClick={() => setConfirmDelete(true)}>
              <Trash2 size={13} /> Delete product
            </button>
          </div>

          <div className="border-t border-[var(--border-card)] pt-3">
            <SpecsEditor
              product={{ ...product, label: name, category, aliases }}
              guide={guide}
              onChanged={onChanged}
              onError={setErr}
            />
          </div>

          {product.ask?.length ? (
            <div className="border-t border-[var(--border-card)] pt-3">
              <span className={label}>Ask prompt (from the schema, read-only in the UI)</span>
              <ul className="mt-1 space-y-1 text-[11px] text-[var(--text-secondary)] list-disc pl-4">
                {product.ask.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </div>
          ) : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this product?"
        message={
          <>
            <b>{product.label}</b> and its {guide.length} spec question{guide.length === 1 ? "" : "s"} are removed from the
            catalogue. Products that still have vendor quotes are refused — delete those rates first. The KYP export stops
            listing this product immediately.
          </>
        }
        confirmLabel="Delete product"
        onConfirm={() => { setConfirmDelete(false); onDelete(); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </Drawer>
  );
}
