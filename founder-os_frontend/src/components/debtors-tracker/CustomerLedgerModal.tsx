"use client";

import type { CustomerAgeingRow } from "@/debtors-tracker/types";
import CustomerLedgerView from "./CustomerLedgerView";

/** Accounts/sales: complete invoice + receipt statement with CSV/print. */
export default function CustomerLedgerModal({
  customer, onClose,
}: {
  customer: CustomerAgeingRow | null;
  onClose: () => void;
}) {
  if (!customer) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-3 py-6" onClick={onClose}>
      <div
        className="w-full max-w-6xl rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <CustomerLedgerView customer={customer} onClose={onClose} />
      </div>
    </div>
  );
}
