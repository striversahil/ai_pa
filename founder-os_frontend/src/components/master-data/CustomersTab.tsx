"use client";

// CustomersTab — the customer list as dispatch-floor cards (one card per
// customer, same shape as CrmDashboard's OrderCard). Filtering, search,
// sorting and paging run on the server (usePagedQuery in the parent —
// founder paging standard 2026-11-21); this file renders one page.
import { ArrowDown, ArrowUp, Phone } from "lucide-react";
import type { MasterCustomer } from "@/master-data/types";
import type { SortKey, SortState } from "@/master-data/filters";
import type { PagedQuery } from "@/hooks/usePagedQuery";
import { ChangesBanner, Pager } from "@/components/ui";
import {
  formatPhone, initials, joinCapped,
  regionLabel, shortDate,
} from "@/master-data/normalize";

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "city", label: "Location" },
  { key: "est", label: "Activity" },
];

export default function CustomersTab({
  list, sort, setSort, onOpen,
}: {
  list: PagedQuery<MasterCustomer>;
  sort: SortState;
  setSort: (s: SortState) => void;
  onOpen: (row: MasterCustomer) => void;
}) {
  if (list.loading && !list.hasData) {
    return <div className="h-[104px] animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/40" />;
  }
  if (list.error != null && !list.hasData) {
    return <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-600">{list.error instanceof Error ? list.error.message : "Could not load customers"}</p>;
  }
  if (list.total === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
        No customers match these filters. Clear the search or widen a filter — search covers the whole book.
      </div>
    );
  }

  return (
    <div className={`space-y-2.5 ${list.loading ? "opacity-60" : ""}`}>
      <ChangesBanner count={list.changes} onRefresh={list.refresh} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          <strong className="text-zinc-900 tabular-nums dark:text-zinc-100">{list.total.toLocaleString("en-IN")}</strong> customers
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-zinc-400">Sort</span>
          <select
            value={sort.key}
            onChange={(e) => setSort({ ...sort, key: e.target.value as SortKey })}
            className="rounded-lg border border-zinc-200 bg-white py-1 pl-2 pr-1 text-[11px] font-semibold text-zinc-600 outline-none focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300"
            aria-label="Sort customers"
          >
            {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setSort({ ...sort, dir: sort.dir === "asc" ? "desc" : "asc" })}
            className="rounded-lg border border-zinc-200 bg-white p-1.5 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
            title={sort.dir === "asc" ? "Ascending — switch to descending" : "Descending — switch to ascending"}
            aria-label="Toggle sort direction"
          >
            {sort.dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {list.rows.map((r) => (
        <CustomerCard key={r.id} row={r} onOpen={onOpen} />
      ))}

      <Pager page={list.page} limit={list.limit} total={list.total} totalPages={list.totalPages} onPage={list.setPage} noun="customers" />
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
        <Fact label="Location" value={[r.state, r.district, r.pincode].filter(Boolean).join(" · ") || "No state / district"} />
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
