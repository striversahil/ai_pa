"use client";

import { useEffect, useMemo, useState } from "react";
import type { CustomerAgeingRow } from "@/debtors-tracker/types";
import { formatINR } from "@/debtors-tracker/types";
import { Card, EmptyState, SearchInput } from "../ui";
import CustomerLedgerView from "../CustomerLedgerView";

/** Full company ledger: searchable company list + complete statement. */
export default function LedgerTab({
  customers,
}: {
  customers: CustomerAgeingRow[];
}) {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...customers].sort((a, b) => b.netDue - a.netDue || a.customerName.localeCompare(b.customerName)),
    [customers],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sorted.filter((c) =>
      !needle ||
      c.customerName.toLowerCase().includes(needle) ||
      (c.phone || "").toLowerCase().includes(needle) ||
      (c.email || "").toLowerCase().includes(needle) ||
      (c.region || "").toLowerCase().includes(needle));
  }, [sorted, query]);

  useEffect(() => {
    if (!selectedKey || !sorted.some((c) => c.customerKey === selectedKey)) {
      setSelectedKey(sorted[0]?.customerKey ?? null);
    }
  }, [sorted, selectedKey]);

  const selected = sorted.find((c) => c.customerKey === selectedKey) ?? null;

  return (
    <div className="space-y-3">
      <Card className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder="Search company, contact, region…" />
          <div className="flex-1" />
          <span className="text-xs text-zinc-400 dark:text-zinc-500">{filtered.length} of {customers.length} companies</span>
        </div>
      </Card>

      {customers.length === 0 ? (
        <EmptyState
          title="No companies yet"
          hint="Import the debtors ageing sheet from the Accounts tab to see a company ledger here."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.9fr)_minmax(0,2.1fr)]">
          <Card className="max-h-[70vh] overflow-hidden">
            <div className="max-h-[70vh] overflow-y-auto p-2">
              {filtered.map((c) => {
                const active = c.customerKey === selected?.customerKey;
                return (
                  <button
                    key={c.customerKey}
                    onClick={() => setSelectedKey(c.customerKey)}
                    className={`mb-1 flex w-full flex-col gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-indigo-300 bg-indigo-50/70 dark:border-indigo-800 dark:bg-indigo-950/30"
                        : "border-transparent hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/50"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{c.customerName}</span>
                      {c.region && (
                        <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                          {c.region}
                        </span>
                      )}
                    </span>
                    <span className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
                      {[c.phone, c.email].filter(Boolean).join(" · ") || "No contact"}
                    </span>
                    <span className="mt-0.5 flex items-center justify-between text-[11px]">
                      <span className="text-zinc-400 dark:text-zinc-500">{c.invoiceCount} invoice{c.invoiceCount === 1 ? "" : "s"}</span>
                      <span className="font-medium tabular-nums text-amber-600 dark:text-amber-400">{formatINR(c.netDue, false)}</span>
                    </span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="px-3 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No companies match the search.</p>
              )}
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            {selected ? (
              <CustomerLedgerView key={selected.customerKey} customer={selected} />
            ) : (
              <EmptyState title="Select a company" hint="Choose a company on the left to open its complete ledger." />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
