"use client";

// CustomersTab — the customer table: sortable, 50-per-page and a row
// drawer. Filtering happens in the parent (so KPI tiles can drive it and the
// CSV export can reuse it); this file sorts + slices only.
//
// Six columns by design: Customer / Type / Location (region badge + city) /
// Contact / Activity (estimates + orders) / Status. Owner, duplicate flags
// and data-quality markers live in the drawer.
import { useEffect, useMemo, useState } from "react";
import type { MasterCustomer } from "@/master-data/types";
import {
  DEFAULT_SORT, compareRows, sortRows, type SortKey, type SortState,
} from "@/master-data/filters";
import {
  formatPhone, initials, joinCapped,
  regionLabel, regionTone, shortDate, statusTone,
} from "@/master-data/normalize";
import { Badge, EmptyState, Table, tdClass, thClass } from "@/components/ui";

const PAGE_SIZE = 50;

const SORTABLE: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: "name", label: "Customer" },
  { key: "type", label: "Type" },
  { key: "city", label: "Location" },
  { key: "est", label: "Activity", numeric: true },
];

function SortHeader({
  label, sortKey, sort, onSort, numeric = false,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  numeric?: boolean;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={`${thClass} sticky top-0 z-10 ${numeric ? "text-right" : ""}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-[var(--text-primary)] ${active ? "text-[var(--color-brand-indigo)]" : ""}`}
        title={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <span className="text-[9px]">{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

function PageButton({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-[var(--radius-control)] border border-[var(--border-card)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-40"
    >
      {label}
    </button>
  );
}

/** Compact page window: first · last · ±1 around current, with gaps. */
function pageWindow(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const keep = new Set([0, total - 1, current - 1, current, current + 1]);
  const pages = [...keep].filter((p) => p >= 0 && p < total).sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && pages[i] - pages[i - 1] > 1) out.push("…");
    out.push(pages[i]);
  }
  return out;
}

export default function CustomersTab({
  rows, onOpen,
}: {
  rows: MasterCustomer[];
  onOpen: (row: MasterCustomer) => void;
}) {
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [page, setPage] = useState(0);

  // Any filter change re-slices from page 1 (the parent passes a new array).
  useEffect(() => { setPage(0); }, [rows]);

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const visible = useMemo(() => sorted.slice(start, start + PAGE_SIZE), [sorted, start]);

  const onSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" || key === "region" || key === "city" || key === "type" ? "asc" : "desc" },
    );
    setPage(0);
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<span className="text-xl">🔎</span>}
        title="No customers match these filters"
        description="Clear the search or widen a filter — the whole book is loaded in this view."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-[var(--text-secondary)]">
        <span>
          Showing <strong className="text-[var(--text-primary)]">{start + 1}–{Math.min(start + PAGE_SIZE, sorted.length)}</strong> of{" "}
          <strong className="text-[var(--text-primary)]">{sorted.length.toLocaleString("en-IN")}</strong> customers
        </span>
        <span className="text-[var(--text-tertiary)]">Click a row for the full record · click a phone number to call</span>
      </div>

      <Table stickyFirst>
        <thead>
          <tr>
            <SortHeader label="Customer" sortKey="name" sort={sort} onSort={onSort} />
            <SortHeader label="Type" sortKey="type" sort={sort} onSort={onSort} />
            <SortHeader label="Location" sortKey="city" sort={sort} onSort={onSort} />
            <th className={`${thClass} sticky top-0 z-10`}>Contact</th>
            <SortHeader label="Activity" sortKey="est" sort={sort} onSort={onSort} numeric />
            <th className={`${thClass} sticky top-0 z-10`}>Status</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr
              key={r.id}
              onClick={() => onOpen(r)}
              className="group cursor-pointer transition-colors odd:bg-[color-mix(in_srgb,var(--surface-soft)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-brand-indigo)_7%,transparent)]"
            >
              <td className={`${tdClass} max-w-[280px] whitespace-normal`}>
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-brand-indigo)_12%,transparent)] text-[10px] font-extrabold text-[var(--color-brand-indigo)]">
                    {initials(r.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--text-primary)]">{r.name}</p>
                    {r.company && r.company !== r.name && (
                      <p className="truncate text-[11px] text-[var(--text-secondary)]">{r.company}</p>
                    )}
                    <p className="truncate text-[10px] text-[var(--text-tertiary)]">Zoho #{r.zohoCustomerId}</p>
                  </div>
                </div>
              </td>
              <td className={tdClass}>
                <span className="text-[var(--text-primary)]">{r.typeBase}</span>
                {r.typeTag && <span className="ml-1.5 rounded bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">{r.typeTag}</span>}
              </td>
              <td className={`${tdClass} max-w-[220px] whitespace-normal`}>
                <Badge tone={regionTone(r.region)}>{regionLabel(r.region)}</Badge>
                <p className="mt-1 truncate text-[var(--text-primary)]">{r.city || "—"}</p>
                <p className="truncate text-[11px] text-[var(--text-secondary)]">
                  {[r.state, r.pincode].filter(Boolean).join(" · ") || "No state / pincode"}
                </p>
              </td>
              <td className={`${tdClass} max-w-[240px] whitespace-normal`}>
                {r.contact && <p className="truncate text-[var(--text-primary)]">{r.contact}{r.designation ? ` · ${r.designation}` : ""}</p>}
                {r.phones[0] ? (
                  <a
                    href={`tel:${r.phones[0].replace(/[^\d+]/g, "")}`}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate text-[11px] font-semibold text-[var(--color-brand-indigo)] hover:underline"
                  >
                    {formatPhone(r.phones[0])}{r.phones.length > 1 ? ` +${r.phones.length - 1}` : ""}
                  </a>
                ) : (
                  <p className="text-[11px] text-[var(--color-danger)]">No phone</p>
                )}
                {r.emails[0] && <p className="truncate text-[11px] text-[var(--text-secondary)]">{joinCapped(r.emails, 1)}</p>}
              </td>
              <td className={`${tdClass} whitespace-normal`}>
                <p className="text-[var(--text-primary)]">
                  <strong>E{r.estCount}</strong> <span className="text-[var(--text-tertiary)]">·</span> <strong className={r.soCount > 0 ? "text-[var(--color-success)]" : ""}>S{r.soCount}</strong>
                </p>
                <p className="text-[10px] text-[var(--text-tertiary)]">
                  {[r.lastEstimateDate ? `est ${shortDate(r.lastEstimateDate)}` : "never quoted",
                    r.lastSalesOrderDate ? `ord ${shortDate(r.lastSalesOrderDate)}` : "never ordered"].join(" · ")}
                </p>
              </td>
              <td className={tdClass}>
                <Badge tone={statusTone(r.status)} dot>{r.status}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      {pageCount > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-caption text-[var(--text-tertiary)]">Page {safePage + 1} of {pageCount}</span>
          <div className="flex items-center gap-1">
            <PageButton disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} label="‹ Prev" />
            {pageWindow(safePage, pageCount).map((p) =>
              p === "…" ? (
                <span key={`gap-${safePage}`} className="px-1 text-[11px] text-[var(--text-tertiary)]">…</span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  aria-current={p === safePage ? "page" : undefined}
                  className={`min-w-[32px] rounded-[var(--radius-control)] px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                    p === safePage
                      ? "bg-[var(--color-brand-indigo)] text-white"
                      : "border border-[var(--border-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {p + 1}
                </button>
              ),
            )}
            <PageButton disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} label="Next ›" />
          </div>
        </div>
      )}
    </div>
  );
}
