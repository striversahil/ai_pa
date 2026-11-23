"use client";

// ProductsTab.tsx — the catalogue: every product, its category, aliases and
// spec count, with the KYP JSON download in the header. Row click opens the
// editor drawer where everything (name, category, aliases, specs) is editable.
import React, { useMemo, useState } from "react";
import { ChevronRight, Download, FolderCog, Plus, Search } from "lucide-react";
import { field, fmtINR, ghostBtn, hueFor, label, panel, primaryBtn } from "../product-line-dashboard/helpers";
import { productLineApi } from "@/product-line/api";
import type { KypProduct, LiveCatalog, Payload } from "@/product-line/types";
import { CategoryManager } from "./CategoryManager";
import { ProductEditor } from "./ProductEditor";
import { TableSkeleton } from "./Skeletons";

const errMsg = (e: unknown) => String((e as any)?.message ?? "request failed");

interface Props {
  payload: Payload | null;
  catalog: LiveCatalog | null;
  loading: boolean;
  canEdit: boolean;
  onChanged: () => void;
  onExport: () => void;
  exporting: boolean;
}

export function ProductsTab({ payload, catalog, loading, canEdit, onChanged, onExport, exporting }: Props) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [manageCats, setManageCats] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rows = useMemo(() => {
    const products = catalog?.products ?? [];
    const counts = new Map((payload?.products ?? []).map((p) => [p.id, p]));
    return products
      .map((p) => ({
        product: p,
        guideCount: payload?.guide?.[p.id]?.length ?? Object.keys(p.props).length,
        rateCount: counts.get(p.id)?.rateCount ?? 0,
        bestPrice: counts.get(p.id)?.bestPrice ?? null,
      }))
      .filter((r) => (cat ? r.product.category === cat : true))
      .filter((r) => {
        const needle = q.trim().toLowerCase();
        if (!needle) return true;
        return (
          r.product.label.toLowerCase().includes(needle) ||
          r.product.key.includes(needle) ||
          r.product.category.toLowerCase().includes(needle) ||
          r.product.aliases.some((a) => a.toLowerCase().includes(needle))
        );
      })
      .sort((a, b) => a.product.category.localeCompare(b.product.category) || a.product.label.localeCompare(b.product.label));
  }, [catalog, payload, q, cat]);

  const open = openId ? catalog?.products.find((p) => p.id === openId) ?? null : null;

  const create = async () => {
    const name = newName.trim();
    const category = (newCategory || catalog?.categories[0] || "").trim();
    if (!name || !category) { setErr("name and category are required"); return; }
    setBusy(true);
    setErr(null);
    try {
      const row = await productLineApi.createProduct({ name, category });
      setNewName("");
      setCreating(false);
      onChanged();
      setOpenId(String((row as any)?.id ?? ""));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (product: KypProduct) => {
    setBusy(true);
    setErr(null);
    try {
      await productLineApi.deleteProduct(product.id);
      setOpenId(null);
      onChanged();
    } catch (e) {
      // Server refuses when vendor quotes reference the product.
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            className={`${field} pl-9 w-64`}
            placeholder="Search product, key, alias…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select className={`${field} w-56`} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {(catalog?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-[11px] font-semibold text-[var(--text-tertiary)]">
          {rows.length} of {catalog?.products.length ?? 0} products
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className={ghostBtn} onClick={() => setManageCats(true)}>
            <FolderCog size={13} /> Categories
          </button>
          <button type="button" className={ghostBtn} onClick={onExport} disabled={exporting}>
            <Download size={13} /> {exporting ? "Building JSON…" : "Download KYP JSON"}
          </button>
          {canEdit ? (
            <button type="button" className={primaryBtn} onClick={() => { setCreating(true); setNewCategory(cat || catalog?.categories[0] || ""); }}>
              <Plus size={13} /> New product
            </button>
          ) : null}
        </div>
      </div>

      {err ? <div className="text-xs font-semibold text-[var(--color-danger)]">{err}</div> : null}

      {creating ? (
        <div className={`${panel} p-3 flex flex-wrap items-end gap-2`}>
          <div className="flex-1 min-w-56">
            <span className={label}>Product name</span>
            <input className={field} autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div className="w-64">
            <span className={label}>Category</span>
            <select className={field} value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
              {(catalog?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => void create()}>Create</button>
          <button type="button" className={ghostBtn} onClick={() => { setCreating(false); setErr(null); }}>Cancel</button>
        </div>
      ) : null}

      <div className={`${panel} overflow-hidden`}>
        <div className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_80px_90px_110px_28px] gap-2 px-4 py-2 border-b border-[var(--border-card)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
          <span>Product</span><span>Category</span><span>Aliases</span><span className="text-right">Specs</span>
          <span className="text-right">Quotes</span><span className="text-right">Best rate</span><span />
        </div>
        {loading && !catalog ? <TableSkeleton rows={10} /> : (
          <div className="divide-y divide-[var(--border-card)]/60">
            {rows.map(({ product, guideCount, rateCount, bestPrice }) => (
              <button
                key={product.id}
                type="button"
                onClick={() => setOpenId(product.id)}
                className="w-full grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_80px_90px_110px_28px] gap-2 px-4 py-2.5 text-left hover:bg-[var(--bg-input)] transition-colors"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-[var(--text-primary)] truncate">{product.label}</span>
                  <span className="block text-[10px] font-mono text-[var(--text-tertiary)] truncate">{product.key}</span>
                </span>
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: hueFor(product.category) }} />
                  <span className="text-[11px] text-[var(--text-secondary)] truncate">{product.category}</span>
                </span>
                <span className="text-[11px] text-[var(--text-tertiary)] truncate">
                  {product.aliases.length ? product.aliases.slice(0, 3).join(" · ") + (product.aliases.length > 3 ? ` +${product.aliases.length - 3}` : "") : "—"}
                </span>
                <span className="text-right text-[11px] font-semibold tabular-nums text-[var(--text-secondary)]">
                  {guideCount}
                  {product.required.length ? <span className="text-[var(--color-danger)]">/{product.required.length}</span> : null}
                </span>
                <span className="text-right text-[11px] tabular-nums text-[var(--text-secondary)]">{rateCount}</span>
                <span className="text-right text-[11px] font-bold tabular-nums text-[var(--text-primary)]">{fmtINR(bestPrice)}</span>
                <span className="flex justify-end text-[var(--text-tertiary)]"><ChevronRight size={14} /></span>
              </button>
            ))}
            {!rows.length && !loading ? (
              <div className="px-4 py-10 text-center text-xs text-[var(--text-tertiary)]">No products match this search.</div>
            ) : null}
          </div>
        )}
      </div>

      {manageCats ? (
        <CategoryManager
          categories={catalog?.categories ?? []}
          products={catalog?.products ?? []}
          canEdit={canEdit}
          onClose={() => setManageCats(false)}
          onChanged={onChanged}
        />
      ) : null}

      {open ? (
        <ProductEditor
          product={open}
          guide={payload?.guide?.[open.id] ?? []}
          categories={catalog?.categories ?? []}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
          onDelete={() => void remove(open)}
        />
      ) : null}
    </div>
  );
}
