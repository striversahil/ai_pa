"use client";

// CustomersTab — the customer list as dispatch-floor cards (one card per
// customer, same shape as CrmDashboard's OrderCard). Filtering happens in the
// parent (so KPI tiles can drive it and the CSV export can reuse it); this
// file sorts + slices only.
import { ArrowDown, ArrowUp, Phone } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MasterCustomer } from "@/master-data/types";
import {
  DEFAULT_SORT, sortRows, type SortKey, type SortState,
} from "@/master-data/filters";
import {
  formatPhone, initials, joinCapped,
  regionLabel, shortDate,
} from "@/master-data/normalize";

const PAGE_SIZE = 50;

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "city", label: "Location" },
  { key: "est", label: "Activity" },
];

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

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
        No customers match these filters. Clear the search or widen a filter — the whole book is loaded in this view.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Showing{" "}
          <strong className="text-zinc-900 tabular-nums dark:text-zinc-100">{start + 1}–{Math.min(start + PAGE_SIZE, sorted.length)}</strong>{" "}
          of <strong className="text-zinc-900 tabular-nums dark:text-zinc-100">{sorted.length.toLocaleString("en-IN")}</strong> customers
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-zinc-400">Sort</span>
          <select
            value={sort.key}
            onChange={(e) => { setSort((p) => ({ ...p, key: e.target.value as SortKey })); setPage(0); }}
            className="rounded-lg border border-zinc-200 bg-white py-1 pl-2 pr-1 text-[11px] font-semibold text-zinc-600 outline-none focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300"
            aria-label="Sort customers"
          >
            {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setSort((p) => ({ ...p, dir: p.dir === "asc" ? "desc" : "asc" }))}
            className="rounded-lg border border-zinc-200 bg-white p-1.5 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
            title={sort.dir === "asc" ? "Ascending — switch to descending" : "Descending — switch to ascending"}
            aria-label="Toggle sort direction"
          >
            {sort.dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {visible.map((r) => (
        <CustomerCard key={r.id} row={r} onOpen={onOpen} />
      ))}

      {pageCount > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-zinc-400">Page {safePage + 1} of {pageCount}</span>
          <div className="flex items-center gap-1">
            <PageButton disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} label="‹ Prev" />
            {pageWindow(safePage, pageCount).map((p) =>
              p === "…" ? (
                <span key={`gap-${p}-${safePage}`} className="px-1 text-[11px] text-zinc-400">…</span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  aria-current={p === safePage ? "page" : undefined}
                  className={`min-w-[30px] rounded-lg px-2 py-1.5 text-[11px] font-semibold tabular-nums transition-colors ${
                    p === safePage
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
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

function CustomerCard({ row: r, onOpen }: { row: MasterCustomer; onOpen: (row: MasterCustomer) => void }) {
  const activity = r.estCount === 0 && r.soCount === 0
    ? "never quoted"
    : `E${r.estCount} · S${r.soCount}`;
  const activitySub = [
    r.lastEstimateDate ? `est ${shortDate(r.lastEstimateDate)}` : null,
    r.lastSalesOrderDate ? `ord ${shortDate(r.lastSalesOrderDate)}` : null,
  ].filter(Boolean).join(" · ") || "no pipeline yet";
  return (
    <div
      onClick={() => onOpen(r)}
      className="group cursor-pointer rounded-2xl border border-zinc-200 bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900/60"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-[10px] font-extrabold text-indigo-600 dark:text-indigo-400">
            {initials(r.name)}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen(r); }}
            className="truncate border-0 bg-transparent p-0 text-left text-sm font-semibold tracking-tight text-zinc-900 underline-offset-2 hover:text-indigo-600 hover:underline dark:text-zinc-100 dark:hover:text-indigo-400"
            title="Open the full record"
          >
            {r.name}
          </button>
          <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:text-zinc-400">
            {r.typeBase}{r.typeTag ? ` ${r.typeTag}` : ""}
          </span>
          <StatusDot status={r.status} />
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{activity}</div>
          <div className="text-[10px] text-zinc-500">{activitySub}</div>
        </div>
      </div>

      {(r.company && r.company !== r.name) || r.city ? (
        <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
          {[r.company && r.company !== r.name ? r.company : null, r.city].filter(Boolean).join(" · ")}
        </p>
      ) : null}

      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-zinc-100 pt-2.5 sm:grid-cols-4 dark:border-zinc-800">
        <Fact label="Location" value={[r.state, r.pincode].filter(Boolean).join(" · ") || "No state / pincode"} />
        <Fact
          label="Phone"
          value={r.phones[0] ? `${formatPhone(r.phones[0])}${r.phones.length > 1 ? ` +${r.phones.length - 1}` : ""}` : "No phone"}
        />
        <Fact label="Region" value={regionLabel(r.region)} />
        <Fact label="Owner" value={r.owner || "—"} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px]">
        {r.contact && (
          <span className="truncate text-zinc-500 dark:text-zinc-400" title={r.contact}>
            {r.contact}{r.designation ? ` · ${r.designation}` : ""}
          </span>
        )}
        {r.emails[0] && <span className="truncate text-zinc-500 dark:text-zinc-400">{joinCapped(r.emails, 1)}</span>}
        {r.duplicateGroup && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-600 dark:text-amber-400">
            dup {r.duplicateGroup}
          </span>
        )}
        {!r.phones.length && (
          <span className="rounded-full bg-rose-500/10 px-2 py-0.5 font-semibold text-rose-600 dark:text-rose-400">no phone</span>
        )}
        {!r.gstin && (
          <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 font-semibold text-zinc-500 dark:text-zinc-400">no GST</span>
        )}
      </div>

      {r.phones[0] && (
        <div className="mt-2.5">
          <a
            href={`tel:${r.phones[0].replace(/[^\d+]/g, "")}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Phone className="h-3.5 w-3.5" />
            Call {formatPhone(r.phones[0])}
          </a>
        </div>
      )}
    </div>
  );
}

/** One labelled fact on a card: muted label above the value. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{label}</div>
      <div className="mt-0.5 truncate text-[11px] font-medium text-zinc-700 dark:text-zinc-200" title={value}>
        {value}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const active = status.toLowerCase() !== "inactive";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        active
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-zinc-400"}`} />
      {status}
    </span>
  );
}

function PageButton({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
