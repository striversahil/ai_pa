"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import type { CustomerAgeingRow, LiveInvoice, DebtorsTrackerPayload } from "@/debtors-tracker/types";
import { deleteCollection, resetDebtorsTracker, runReminderDryRun } from "@/debtors-tracker/api";
import { TabBar } from "@/components/ui/TabBar";
import ImportModal, { type ImportKind } from "./debtors-tracker/ImportModal";
import InvoiceEditModal from "./debtors-tracker/InvoiceEditModal";
import CustomerContactModal from "./debtors-tracker/CustomerContactModal";
import CustomerSituationModal from "./debtors-tracker/CustomerSituationModal";
import CustomerLedgerModal from "./debtors-tracker/CustomerLedgerModal";
import AccountsTab from "./debtors-tracker/tabs/AccountsTab";
import SummaryTab from "./debtors-tracker/tabs/SummaryTab";
import AgeingTab from "./debtors-tracker/tabs/AgeingTab";
import InvoicesTab from "./debtors-tracker/tabs/InvoicesTab";
import CollectionsTab from "./debtors-tracker/tabs/CollectionsTab";
import LedgerTab from "./debtors-tracker/tabs/LedgerTab";
import RemindersTab from "./debtors-tracker/tabs/RemindersTab";
import { Card } from "./debtors-tracker/ui";

type View = "summary" | "ageing" | "invoices" | "collections" | "ledger" | "reminders" | "accounts";

export default function DebtorsTrackerDashboard() {
  const { me } = useAuth();
  const canAccounts = !!me && (me.isAdmin || me.scopes.includes("accounts"));

  const dash = useLiveDashboard<DebtorsTrackerPayload>(
    () => fetch("/api/debtors-tracker/data", { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`);
      return r.json() as Promise<DebtorsTrackerPayload>;
    }),
  );

  const [view, setView] = useState<View | null>(null);
  const [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [editing, setEditing] = useState<LiveInvoice | null>(null);
  const [contact, setContact] = useState<CustomerAgeingRow | null>(null);
  const [situation, setSituation] = useState<CustomerAgeingRow | null>(null);
  const [ledgerCustomer, setLedgerCustomer] = useState<CustomerAgeingRow | null>(null);
  const [resetting, setResetting] = useState(false);
  const [reminderRunning, setReminderRunning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const data = dash.data ?? null;
  const loading = dash.loading && !data;
  const errorMsg = dash.error ? String(dash.error) : null;

  const tabs = useMemo(() => {
    const base: { key: View; label: string; icon: string; count?: number }[] = [
      { key: "summary", label: "Summary", icon: "📊" },
      { key: "ageing", label: "Customer Ageing", icon: "📅", count: data?.summary.customerCount },
      { key: "invoices", label: "Invoices", icon: "🧾", count: data?.summary.invoiceCount },
      { key: "collections", label: "Collections", icon: "💰", count: data?.summary.collectionCount },
      { key: "ledger", label: "Ledger", icon: "📖", count: data?.summary.customerCount },
      { key: "reminders", label: "Reminders", icon: "📲", count: data?.reminders.filter((r) => r.runDay === data.meta.reminderRunDay).length },
    ];
    if (canAccounts) base.push({ key: "accounts", label: "Accounts", icon: "⚙️" });
    return base;
  }, [canAccounts, data]);

  // First-time accounts users land on the paste screen; sales land on Summary.
  const defaultView: View = canAccounts && (!data || data.summary.invoiceCount === 0) ? "accounts" : "summary";
  const activeView: View = view && tabs.some((t) => t.key === view) ? view : defaultView;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const lastImportAt = useMemo(() => {
    const dates = (data?.invoices ?? []).map((i) => i.lastImportAt).filter(Boolean) as string[];
    return dates.length ? dates.sort().at(-1)! : null;
  }, [data?.invoices]);

  const lastCollectionDate = useMemo(() => {
    const dates = (data?.collections ?? []).map((c) => c.collectionDate).filter(Boolean) as string[];
    return dates.length ? dates.sort().at(-1)! : null;
  }, [data?.collections]);

  const reset = async () => {
    if (!window.confirm("Wipe ALL debtors tracker data (invoices + collections + reminder previews)? This cannot be undone.")) return;
    setResetting(true);
    try {
      await resetDebtorsTracker();
      setToast("Debtors tracker data cleared. Customer contacts were kept.");
      dash.refresh();
    } catch (e: any) {
      setToast(e?.message ?? "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  const removeCollection = async (c: { id: string; amount: number; customerName: string }) => {
    if (!window.confirm(`Delete the collection from ${c.customerName}?`)) return;
    try {
      await deleteCollection(c.id);
      setToast("Collection deleted.");
      dash.refresh();
    } catch (e: any) {
      setToast(e?.message ?? "Delete failed");
    }
  };

  const followUp = (customerName: string) => {
    const inv = (data?.invoices ?? [])
      .filter((i) => i.customerName === customerName && i.balance > 0.005)
      .sort((a, b) => (b.daysOverdue ?? -1e9) - (a.daysOverdue ?? -1e9))[0];
    if (inv) setEditing(inv);
    else setToast(`No open invoice to follow up for ${customerName}.`);
  };

  const runReminders = async () => {
    setReminderRunning(true);
    try {
      await runReminderDryRun();
      setToast("Today's reminder dry-run logged. Nothing was sent on WhatsApp.");
      dash.refresh();
    } catch (e: any) {
      setToast(e?.message ?? "Reminder run failed");
    } finally {
      setReminderRunning(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-6 text-zinc-900 md:px-8 dark:text-zinc-100">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Debtors Tracker</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Debtors, ageing, live collections and reminder previews for the accounts desk and sales follow-up.
          </p>
        </div>
        {data && (
          <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live · as of {data.meta.asOfIST}
          </div>
        )}
      </header>

      <div className="w-full shrink-0">
        <TabBar items={tabs} active={activeView} onChange={setView} />
      </div>

      {errorMsg && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          <span>{errorMsg}</span>
          <button onClick={() => dash.refresh()} className="rounded-lg border border-rose-300 px-3 py-1 text-xs font-medium hover:bg-rose-100 dark:border-rose-800 dark:hover:bg-rose-950/50">Retry</button>
        </Card>
      )}

      {data && (data.meta.invoiceConflicts?.length ?? 0) > 0 && (
        <Card className="border-amber-200 bg-amber-50/60 px-4 py-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-300">
          <div className="font-semibold">
            {data.meta.invoiceConflicts.length} invoice number{data.meta.invoiceConflicts.length === 1 ? " is" : "s are"} shared by multiple customers
          </div>
          <div className="mt-1 opacity-80">
            Both receivables are kept — never merged. Collections with a shared invoice no. are matched by customer.
          </div>
          <div className="mt-1.5 space-y-0.5 font-mono text-[11px]">
            {data.meta.invoiceConflicts.slice(0, 4).map((c) => (
              <div key={c.invoiceNo} className="truncate" title={c.customers.join(" · ")}>
                {c.invoiceNo} → {c.customers.join(" · ")}
              </div>
            ))}
            {data.meta.invoiceConflicts.length > 4 && <div>+{data.meta.invoiceConflicts.length - 4} more</div>}
          </div>
        </Card>
      )}

      {loading && <LoadingSkeleton />}

      {data && activeView === "accounts" && canAccounts && (
        <AccountsTab
          invoiceCount={data.summary.invoiceCount}
          collectionCount={data.summary.collectionCount}
          customerCount={data.summary.customerCount}
          lastImportAt={lastImportAt}
          lastCollectionDate={lastCollectionDate}
          onImport={setImportKind}
          onReset={reset}
          resetting={resetting}
        />
      )}
      {data && activeView === "summary" && <SummaryTab summary={data.summary} collections={data.collections} receiptAgeing={data.receiptAgeing} asOfIST={data.meta.asOfIST} />}
      {data && activeView === "ageing" && (
        <AgeingTab
          customers={data.customers}
          canAccounts={canAccounts}
          onGoToAccounts={() => setView("accounts")}
          onEditContact={setContact}
          onEditSituation={setSituation}
          onFollowUp={followUp}
          onViewLedger={setLedgerCustomer}
        />
      )}
      {data && activeView === "invoices" && (
        <InvoicesTab invoices={data.invoices} onEdit={setEditing} onGoToAccounts={() => setView("accounts")} />
      )}
      {data && activeView === "collections" && (
        <CollectionsTab
          collections={data.collections}
          onDelete={removeCollection}
          onGoToAccounts={() => setView("accounts")}
          canDelete={canAccounts}
        />
      )}
      {data && activeView === "ledger" && (
        <LedgerTab customers={data.customers} />
      )}
      {data && activeView === "reminders" && (
        <RemindersTab
          reminders={data.reminders}
          customers={data.customers}
          meta={data.meta}
          canAccounts={canAccounts}
          onRun={runReminders}
          running={reminderRunning}
        />
      )}

      <ImportModal
        kind={importKind}
        onClose={() => setImportKind(null)}
        onDone={(msg) => {
          setImportKind(null);
          setToast(msg);
          dash.refresh();
        }}
      />

      <InvoiceEditModal
        key={editing?.id ?? "none"}
        invoice={editing}
        canAccounts={canAccounts}
        onClose={() => setEditing(null)}
        onSaved={(msg) => {
          setEditing(null);
          setToast(msg);
          dash.refresh();
        }}
      />

      <CustomerContactModal
        key={contact?.customerKey ?? "none"}
        customer={contact}
        onClose={() => setContact(null)}
        onSaved={(msg) => {
          setContact(null);
          setToast(msg);
          dash.refresh();
        }}
      />

      <CustomerSituationModal
        key={situation?.customerKey ?? "none"}
        customer={situation}
        onClose={() => setSituation(null)}
        onSaved={(msg) => {
          setSituation(null);
          setToast(msg);
          dash.refresh();
        }}
      />

      <CustomerLedgerModal
        key={ledgerCustomer?.customerKey ?? "none"}
        customer={ledgerCustomer}
        onClose={() => setLedgerCustomer(null)}
      />

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm text-zinc-700 shadow-lg dark:border-emerald-900/60 dark:bg-zinc-900 dark:text-zinc-200">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
          <span className="flex-1">{toast}</span>
          <button onClick={() => setToast(null)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" aria-label="Dismiss">✕</button>
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl border border-zinc-200/80 bg-zinc-100/70 dark:border-zinc-800 dark:bg-zinc-800/40" />
        ))}
      </div>
      <div className="h-64 rounded-2xl border border-zinc-200/80 bg-zinc-100/70 dark:border-zinc-800 dark:bg-zinc-800/40" />
    </div>
  );
}
