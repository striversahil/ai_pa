"use client";

// DashboardModals — the debtors dashboard's modal stack (import, invoice edit,
// customer contact, customer situation, customer ledger).
//
// Extracted verbatim from DebtorsTrackerDashboard so that file stays under the
// 400-line split threshold (AGENTS.md). The dashboard still owns all state and
// mutation wiring; this component only renders the five modals and forwards
// their close/save callbacks. Behaviour is identical.
import ImportModal, { type ImportKind } from "./ImportModal";
import InvoiceEditModal from "./InvoiceEditModal";
import CustomerContactModal from "./CustomerContactModal";
import CustomerSituationModal from "./CustomerSituationModal";
import CustomerLedgerModal from "./CustomerLedgerModal";
import type { CustomerAgeingRow, LiveInvoice } from "@/debtors-tracker/types";

export interface DashboardModalsProps {
  importKind: ImportKind | null;
  editing: LiveInvoice | null;
  contact: CustomerAgeingRow | null;
  situation: CustomerAgeingRow | null;
  ledgerCustomer: CustomerAgeingRow | null;
  canAccounts: boolean;
  onCloseImport: () => void;
  onCloseEditing: () => void;
  onCloseContact: () => void;
  onCloseSituation: () => void;
  onCloseLedger: () => void;
  /** Success message from any modal (the parent owns the toast). */
  onSaved: (msg: string) => void;
  /** Refetch after a mutation (echo-suppressed by the parent). */
  onChanged: () => void;
}

export default function DashboardModals({
  importKind,
  editing,
  contact,
  situation,
  ledgerCustomer,
  canAccounts,
  onCloseImport,
  onCloseEditing,
  onCloseContact,
  onCloseSituation,
  onCloseLedger,
  onSaved,
  onChanged,
}: DashboardModalsProps) {
  return (
    <>
      <ImportModal
        kind={importKind}
        onClose={onCloseImport}
        onDone={(msg) => {
          onCloseImport();
          onSaved(msg);
          onChanged();
        }}
      />

      <InvoiceEditModal
        key={editing?.id ?? "none"}
        invoice={editing}
        canAccounts={canAccounts}
        onClose={onCloseEditing}
        onSaved={(msg) => {
          onCloseEditing();
          onSaved(msg);
          onChanged();
        }}
      />

      <CustomerContactModal
        key={contact?.customerKey ?? "none"}
        customer={contact}
        canAccounts={canAccounts}
        onClose={onCloseContact}
        onSaved={(msg) => {
          onCloseContact();
          onSaved(msg);
          onChanged();
        }}
      />

      <CustomerSituationModal
        key={situation?.customerKey ?? "none"}
        customer={situation}
        canAccounts={canAccounts}
        onClose={onCloseSituation}
        onSaved={(msg) => {
          // Stays open so several daily remarks / promise edits can be added.
          onSaved(msg);
          onChanged();
        }}
      />

      <CustomerLedgerModal
        key={ledgerCustomer?.customerKey ?? "none"}
        customer={ledgerCustomer}
        onClose={onCloseLedger}
      />
    </>
  );
}
