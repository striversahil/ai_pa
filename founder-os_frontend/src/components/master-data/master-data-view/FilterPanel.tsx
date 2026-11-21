"use client";

// Customer Master filter panel — extracted verbatim from MasterDataView.tsx
// (kept the view under the 400-line limit). Props-only; options come from the
// server summary (region-scoped, districts per picked state).
import type { FilterOptions } from "@/master-data/types";
import type { MasterFilters } from "@/master-data/filters";
import { Chip, FilterSelect } from "../ui";
import { DUPLICATE_OPTIONS } from "./helpers";

export function FilterPanel({ filters, set, setState, options }: {
  filters: MasterFilters;
  set: <K extends keyof MasterFilters>(key: K, value: MasterFilters[K]) => void;
  setState: (state: string) => void;
  options: FilterOptions;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <FilterSelect label="Status" value={filters.status} onChange={(v) => set("status", v)} options={["Active", "Inactive"]} allLabel="Any status" />
        <FilterSelect label="Type" value={filters.typeBase} onChange={(v) => set("typeBase", v)} options={options.types} allLabel="Any type" />
        <FilterSelect label="State" value={filters.state} onChange={setState} options={options.states} allLabel="Any state" />
        <FilterSelect label="District" value={filters.district} onChange={(v) => set("district", v)} options={options.districts} allLabel={filters.state ? "Any district" : "Pick a state first"} />
        <FilterSelect label="Sub-area" value={filters.subArea} onChange={(v) => set("subArea", v)} options={options.subAreas} allLabel="Any sub-area" />
        <FilterSelect label="Owner" value={filters.owner} onChange={(v) => set("owner", v)} options={options.owners} allLabel="Any owner" />
        <FilterSelect label="Pipeline" value={filters.pipeline} onChange={(v) => set("pipeline", v)} options={options.pipelines} allLabel="Any stage" />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Duplicates</span>
          <select
            value={filters.duplicates}
            onChange={(e) => set("duplicates", e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
          >
            {DUPLICATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-1.5 pt-4">
          <Chip active={filters.hasPhone} onClick={() => set("hasPhone", !filters.hasPhone)} title="Only rows with a phone number">With phone</Chip>
          <Chip active={filters.hasEmail} onClick={() => set("hasEmail", !filters.hasEmail)} title="Only rows with an email">With email</Chip>
          <Chip active={filters.hasGstin} onClick={() => set("hasGstin", !filters.hasGstin)} title="Only rows with a GSTIN">With GSTIN</Chip>
          <Chip active={filters.hasPincode} onClick={() => set("hasPincode", !filters.hasPincode)} title="Only rows with a pincode">With pincode</Chip>
        </div>
      </div>
    </div>
  );
}
