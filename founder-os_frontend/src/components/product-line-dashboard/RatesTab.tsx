"use client";

// Rates tab — every vendor quote, 50 per page, searched across the whole
// table on the server (founder paging standard 2026-11-21). Props-only: the
// parent owns the usePagedQuery hook and the write actions.
import { Pencil, Plus, Search, Tag, Trash2 } from "lucide-react";
import { ChangesBanner, Pager } from "@/components/ui";
import type { PagedQuery } from "@/hooks/usePagedQuery";
import type { RateRow } from "./types";
import { dangerBtn, field, fmtINR, ghostBtn, panel, primaryBtn, specSummary } from "./helpers";

export function RatesTab({ list, status, setStatus, canQuote, busy, canAdd, onAdd, onOpenProduct, onEdit, onToggle, onDelete }: {
  list: PagedQuery<RateRow>;
  status: string;
  setStatus: (s: string) => void;
  canQuote: boolean;
  busy: boolean;
  canAdd: boolean;
  onAdd: () => void;
  onOpenProduct: (productId: string) => void;
  onEdit: (r: RateRow) => void;
  onToggle: (r: RateRow) => void;
  onDelete: (r: RateRow) => void;
}) {
  const td = "py-2.5 px-3 border-b border-[var(--border-card)]/60";
  return (
    <div className={`${panel} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 pt-4">
        <div className="relative w-full sm:w-80">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input value={list.q} onChange={(e) => list.setQ(e.target.value)} placeholder="Search product, vendor, spec, notes…" className={`${field} !pl-9`} />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${field} !w-auto`}>
          <option value="">All quotes</option>
          <option value="on">On only</option>
          <option value="off">Off only</option>
        </select>
        <span className="flex-1" />
        {canQuote && <button type="button" disabled={busy || !canAdd} onClick={onAdd} className={primaryBtn}><Plus size={14} /> Quote</button>}
      </div>
      <div className="px-4 sm:px-5 pt-3"><ChangesBanner count={list.changes} onRefresh={list.refresh} /></div>
      <div className={`overflow-x-auto p-2 sm:p-3 ${list.loading && list.hasData ? "opacity-60" : ""}`}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left">
              {["Product", "Vendor", "Spec", "Price", "MOQ", "Status"].map((h, i) => (
                <th key={h} className={`py-2.5 px-3 text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-card)] ${i === 3 ? "text-right" : ""}`}>{h}</th>
              ))}
              {canQuote && <th className="py-2.5 px-3 border-b border-[var(--border-card)]"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {list.rows.map((r) => (
              <tr key={r.id}>
                <td className={`${td} font-bold text-[var(--text-primary)]`}>
                  {r.productId
                    ? <button type="button" onClick={() => onOpenProduct(r.productId as string)} className="cursor-pointer bg-transparent border-0 p-0 font-bold text-brand-indigo hover:underline text-left">{r.productName ?? "—"}</button>
                    : (r.productName ?? "—")}
                </td>
                <td className={`${td} text-[var(--text-secondary)]`}>{r.vendorName ?? "—"}</td>
                <td className={`${td} text-xs text-[var(--text-tertiary)] max-w-56 truncate`} title={Object.entries(r.attrValues ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ")}>{specSummary(r)}</td>
                <td className={`${td} text-right font-extrabold tabular-nums text-[var(--text-primary)] whitespace-nowrap`}>{r.pricePerUnit != null ? `${fmtINR(r.pricePerUnit)}${r.unit ? `/${r.unit}` : ""}` : "—"}</td>
                <td className={`${td} text-[var(--text-secondary)]`}>{r.moq || "—"}</td>
                <td className={td}>
                  {r.active
                    ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> On</span>
                    : <span className="inline-flex items-center gap-1 text-[11px] font-bold text-zinc-500"><span className="h-1.5 w-1.5 rounded-full bg-zinc-500" /> Off</span>}
                </td>
                {canQuote && (
                  <td className={`${td} text-right whitespace-nowrap`}>
                    <button type="button" onClick={() => onEdit(r)} className={ghostBtn}><Pencil size={12} /> Edit</button>{" "}
                    <button type="button" disabled={busy} onClick={() => onToggle(r)} className={ghostBtn}>{r.active ? "Turn off" : "Turn on"}</button>{" "}
                    <button type="button" disabled={busy} onClick={() => onDelete(r)} className={dangerBtn}><Trash2 size={12} /> Delete</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {list.loading && !list.hasData && <p className="py-10 text-center text-sm text-[var(--text-tertiary)]">Loading quotes…</p>}
        {list.hasData && list.total === 0 && (
          <div className="py-10 text-center">
            <Tag size={26} className="mx-auto text-[var(--text-tertiary)]" />
            <p className="mt-2 text-sm font-bold text-[var(--text-primary)]">{list.q || status ? "No quotes match" : "No quotes recorded yet"}</p>
          </div>
        )}
        {list.error != null && <p className="py-3 text-center text-sm font-bold text-[var(--color-danger)]">{list.error instanceof Error ? list.error.message : String(list.error)}</p>}
        <Pager page={list.page} limit={list.limit} total={list.total} totalPages={list.totalPages} onPage={list.setPage} noun="quotes" />
      </div>
    </div>
  );
}
