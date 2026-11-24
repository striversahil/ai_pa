"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import type { CustomerAgeingRow, LiveInvoice, DebtorsTrackerPayload } from "@/debtors-tracker/types";
import { deleteCollection, getDebtorsTrackerData, recordReceivablesExport, resetDebtorsTracker, runReminderDryRun } from "@/debtors-tracker/api";
import { isLiveRange, loadStoredRange, normalizeRange, storeRange, type DebtorsRange } from "@/debtors-tracker/range";
import { buildOverdueReceivableRows, downloadOverdueReceivablesCsv } from "@/debtors-tracker/receivables-export";
import { TabBar } from "@/components/ui/TabBar";
import ImportModal, { type ImportKind } from "./debtors-tracker/ImportModal";
import DashboardModals from "./debtors-tracker/DashboardModals";
import RangeBar from "./debtors-tracker/RangeBar";
import DashboardHeader from "./debtors-tracker/DashboardHeader";
import AccountsTab from "./debtors-tracker/tabs/AccountsTab";
import SummaryTab from "./debtors-tracker/tabs/SummaryTab";
import AgeingTab from "./debtors-tracker/tabs/AgeingTab";
import InvoicesTab from "./debtors-tracker/tabs/InvoicesTab";
import CollectionsTab from "./debtors-tracker/tabs/CollectionsTab";
import LedgerTab from "./debtors-tracker/tabs/LedgerTab";
import RemindersTab from "./debtors-tracker/tabs/RemindersTab";
import { Card } from "./debtors-tracker/ui";

type View = "summary" | "ageing" | "invoices" | "collections" | "ledger" | "reminders" | "accounts";

/** Ignore socket echoes of our own writes inside this window (debounce is 1.5s). */
const ECHO_SUPPRESS_MS = 2000;

export default function DebtorsTrackerDashboard() {
  const { me } = useAuth();
  const canAccounts = !!me && (me.isAdmin || me.scopes.includes("accounts"));

  /**
   * Every mutation below broadcasts a `debtors` live event (see backend
   * `worker/routes/debtors-tracker.ts` — situation, remarks, imports, edits
   * all `notifyLive`). Without suppression each save refetches twice: once
   * here, once ~1.5s later when the socket echo arrives. Stamping our own
   * writes and ignoring events inside the echo window keeps it to one fetch.
   */
  const lastMutatedRef = useRef(0);
  /**
   * "As of" range. `to` is the snapshot the whole dashboard shows, `from` the
   * comparison point (then vs now). Both null = today's live view.
   * Loaded after mount so the static export never hydrates from localStorage.
   */
  const [range, setRangeState] = useState<DebtorsRange>({ from: null, to: null });
  useEffect(() => {
    const stored = loadStoredRange();
    if (!isLiveRange(stored)) setRangeState(stored);
  }, []);
  const setRange = (next: DebtorsRange) => {
    const normalized = normalizeRange(next);
    setRangeState(normalized);
    storeRange(normalized);
  };
  const fetchData = () => getDebtorsTrackerData({ asOf: range.to, from: range.from });
  const dash = useLiveQuery<DebtorsTrackerPayload>(fetchData, {
    deps: [range.from, range.to],
    events: (e) => e.type === "debtors" && Date.now() - lastMutatedRef.current > ECHO_SUPPRESS_MS,
  });
  const refreshAfterMutation = () => {
    lastMutatedRef.current = Date.now();
    dash.refresh();
  };
  /** Historical snapshots are read-only — say so instead of opening an editor. */
  const lockNotice = () => setToast("Switch back to today to edit — historical snapshots are read-only.");
  const openInvoice = (inv: LiveInvoice) => (locked ? lockNotice() : setEditing(inv));
  const openContact = (row: CustomerAgeingRow) => (locked ? lockNotice() : setContact(row));
  const openSituation = (row: CustomerAgeingRow) => (locked ? lockNotice() : setSituation(row));

  const [view, setView] = useState<View | null>(null);
  const [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [editing, setEditing] = useState<LiveInvoice | null>(null);
  const [contact, setContact] = useState<CustomerAgeingRow | null>(null);
  const [situation, setSituation] = useState<CustomerAgeingRow | null>(null);
  const [ledgerCustomer, setLedgerCustomer] = useState<CustomerAgeingRow | null>(null);
  const [resetting, setResetting] = useState(false);
  const [reminderRunning, setReminderRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  /** Last confirmed global export number — fallback if the counter POST fails. */
  const lastExportCount = useRef(0);

  const data = dash.data ?? null;
  const loading = dash.loading && !data;
  const errorMsg = dash.error ? String(dash.error) : null;
  /** Historical snapshots are read-only: money edits must be made on live data. */
  const locked = !!data?.meta.isHistorical;
  const canEdit = canAccounts && !locked;

  // Count shown on the header button; the click re-fetches before exporting.
  const overdueRows = useMemo(
    () => buildOverdueReceivableRows(data?.invoices ?? [], data?.customers ?? []),
    [data?.invoices, data?.customers],
  );

  const tabs = useMemo(() => {
    const base: { key: View; label: string; icon: string; count?: number }[] = [
      { key: "summary", label: "Summary", icon: "📊" },
      { key: "ageing", label: "Customer Ageing", icon: "📅", count: data?.summary.customerCount },
      { key: "invoices", label: "Invoices", icon: "🧾", count: data?.summary.invoiceCount },
      { key: "collections", label: "Collections", icon: "💰", count: data?.summary.collectionCount },
      { key: "ledger", label: "Ledger", icon: "📖", count: data?.summary.customerCount },
      { key: "reminders", label: "Reminders", icon: "📲", count: data?.reminders.filter((r) => r.runDay === data.meta.reminderRunDay).length },
    ];
    if (canAccounts && !locked) base.push({ key: "accounts", label: "Accounts", icon: "⚙️" });
    return base;
  }, [canAccounts, locked, data]);

  // First-time accounts users land on the paste screen; sales land on Summary.
  const defaultView: View = canAccounts && !locked && (!data || data.summary.invoiceCount === 0) ? "accounts" : "summary";
  const activeView: View = view && tabs.some((t) => t.key === view) ? view : defaultView;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Switching to a historical snapshot closes any editor opened on live data —
  // a save there would apply today's numbers to a past view.
  useEffect(() => {
    if (!locked) return;
    setEditing(null);
    setContact(null);
    setSituation(null);
    setImportKind(null);
  }, [locked]);

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
      refreshAfterMutation();
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
      refreshAfterMutation();
    } catch (e: any) {
      setToast(e?.message ?? "Delete failed");
    }
  };

  const followUp = (customerName: string) => {
    if (locked) return lockNotice();
    const inv = (data?.invoices ?? [])
      .filter((i) => i.customerName === customerName && i.balance > 0.005)
      .sort((a, b) => (b.daysOverdue ?? -1e9) - (a.daysOverdue ?? -1e9))[0];
    if (inv) setEditing(inv);
    else setToast(`No open invoice to follow up for ${customerName}.`);
  };

  const runReminders = async () => {
    if (locked) return lockNotice();
    setReminderRunning(true);
    try {
      await runReminderDryRun();
      setToast("Today's reminder dry-run logged. Nothing was sent on WhatsApp.");
      refreshAfterMutation();
    } catch (e: any) {
      setToast(e?.message ?? "Reminder run failed");
    } finally {
      setReminderRunning(false);
    }
  };

  /**
   * Downloads only clients with at least one live, past-due, unpaid bill.
   * Re-fetches first so the CSV is current even if the tab missed an event;
   * falls back to the live payload on screen if that refresh fails.
   *
   * The download is logged BEFORE the file is written, because the "Count"
   * column must show this download's number (first ever file → 1).
   */
  const downloadOverdueCsv = async () => {
    if (!data || exporting) return;
    setExporting(true);
    try {
      let payload = data;
      try {
        payload = await getDebtorsTrackerData({ asOf: range.to, from: range.from });
      } catch {
        // Keep the live payload already on screen.
      }
      const rows = buildOverdueReceivableRows(payload.invoices, payload.customers);
      if (rows.length === 0) {
        setToast("No overdue receivables to export.");
        return;
      }
      let exportCount = lastExportCount.current;
      let counted = true;
      try {
        const stats = await recordReceivablesExport(rows.length);
        exportCount = stats.count;
        lastExportCount.current = stats.count;
      } catch {
        counted = false;
      }
      downloadOverdueReceivablesCsv(rows, payload.meta.asOfIST, exportCount);
      const clients = `${rows.length} client${rows.length === 1 ? "" : "s"}`;
      setToast(
        counted
          ? `Downloaded ${clients} · export #${exportCount}.`
          : `Downloaded ${clients}, but the export count could not be updated.`,
      );
    } catch (e: any) {
      setToast(e?.message ?? "CSV export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-6 text-zinc-900 md:px-8 dark:text-zinc-100">
      <DashboardHeader
        hasData={!!data}
        overdueCount={overdueRows.length}
        exporting={exporting}
        onExport={() => void downloadOverdueCsv()}
        asOfIST={data?.meta.asOfIST ?? ""}
        historical={locked}
      />

      {data && (
        <RangeBar
          range={range}
          onChange={setRange}
          coverage={data.meta.coverage}
          isHistorical={!!data.meta.isHistorical}
          asOfIST={data.meta.asOfIST}
          rangeFrom={data.meta.rangeFrom}
          caveats={data.meta.caveats}
        />
      )}

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

      {data && activeView === "accounts" && canEdit && (
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
      {data && activeView === "summary" && (
        <SummaryTab
          summary={data.summary}
          collections={data.collections}
          customers={data.customers}
          receiptAgeing={data.receiptAgeing}
          asOfIST={data.meta.asOfIST}
          compare={data.compare ?? null}
        />
      )}
      {data && activeView === "ageing" && (
        <AgeingTab
          customers={data.customers}
          topPicks={data.topPicks ?? []}
          topN={data.topN ?? 20}
          canAccounts={canEdit}
          onGoToAccounts={() => setView("accounts")}
          onEditContact={openContact}
          onEditSituation={openSituation}
          onFollowUp={followUp}
          onViewLedger={setLedgerCustomer}
          onTopChanged={() => refreshAfterMutation()}
        />
      )}
      {data && activeView === "invoices" && (
        <InvoicesTab
          invoices={data.invoices}
          onEdit={openInvoice}
          onGoToAccounts={() => setView("accounts")}
          canAccounts={canEdit}
          onChanged={() => refreshAfterMutation()}
        />
      )}
      {data && activeView === "collections" && (
        <CollectionsTab
          collections={data.collections}
          onDelete={removeCollection}
          onGoToAccounts={() => setView("accounts")}
          canDelete={canEdit}
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
          canAccounts={canEdit}
          onRun={runReminders}
          running={reminderRunning}
        />
      )}

      <DashboardModals
        importKind={importKind}
        editing={editing}
        contact={contact}
        situation={situation}
        ledgerCustomer={ledgerCustomer}
        canAccounts={canAccounts}
        asOf={data?.meta.isHistorical ? data.meta.asOfIST : null}
        onCloseImport={() => setImportKind(null)}
        onCloseEditing={() => setEditing(null)}
        onCloseContact={() => setContact(null)}
        onCloseSituation={() => setSituation(null)}
        onCloseLedger={() => setLedgerCustomer(null)}
        onSaved={(msg) => setToast(msg)}
        onChanged={refreshAfterMutation}
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
