"use client";

// CrmCashPanel — the dispatch cash ledger on the dispatch floor.
//
// Moved here from the Accounts dashboard (2026-11-26): the floor spends the
// cash, so the floor books it. Mounted only while its tab is open, so the
// ledger is never fetched for someone reading order tabs.
import DispatchCash from "@/crm/DispatchCash";
import { useCrmCash } from "@/crm/hooks";

export default function CrmCashPanel({ canWrite }: { canWrite: boolean }) {
  const cash = useCrmCash();
  return (
    <div className="space-y-3">
      {!!cash.error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
          Could not load the cash ledger: {cash.error instanceof Error ? cash.error.message : String(cash.error)}
        </div>
      )}
      <DispatchCash
        entries={cash.data?.entries ?? []}
        summary={cash.data?.summary ?? null}
        canAdd={canWrite}
        canEdit={canWrite}
        onRefresh={cash.refresh}
      />
    </div>
  );
}
