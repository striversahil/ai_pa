"use client";

// ProductLineDashboard.tsx — the Product Line workspace shell.
//
// Three tabs over one editable catalogue (founder decision 2026-11-23):
//   Products — every product with its category, aliases and spec ask, all
//              editable, plus the KYP JSON download built from this data;
//   Vendors  — the supplier master (brands are NOT vendors);
//   Rates    — vendor quotes as a spreadsheet with server-side filters,
//              up to 500 rows a page, "Missing (n)" per row and a drawer to
//              view/edit every field of a quote.
//
// 2026-11-23 v3: the header is one aligned action cluster (New rate · Batch log ·
// KYP JSON · Copy prompt · Paste AI rates · Refresh) and EXACTLY ONE overlay can
// be open — opening a second closes the first, so drawers never stack.
import React, { useCallback, useMemo, useState } from "react";
import { ClipboardPaste, Download, History, MessageSquareCode, Package, Plus, RefreshCw, Users, Wallet } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { fmtINR, ghostBtn, panel, primaryBtn } from "./product-line-dashboard/helpers";
import { downloadKypSchema } from "@/product-line/api";
import { useBatches, useCatalog, usePayload, useRateDetail, useRates } from "@/product-line/hooks";
import { BatchLogDrawer } from "./product-line/BatchLogDrawer";
import { ProductsTab } from "./product-line/ProductsTab";
import { PromptDrawer } from "./product-line/PromptDrawer";
import { RateDrawer } from "./product-line/RateDrawer";
import { RateImporter } from "./product-line/RateImporter";
import { RatesSheet } from "./product-line/RatesSheet";
import { VendorsTab } from "./product-line/VendorsTab";

type Tab = "products" | "vendors" | "rates";
/** One overlay at a time — see the header comment. */
type Overlay = "prompt" | "import" | "batches" | null;

export default function ProductLineDashboard() {
  const { me } = useAuth();
  // Catalogue + quote writes: root/admin, or anyone holding `product-line`.
  const canEdit = !!me && (!!me.isAdmin || (me.scopes ?? []).includes("product-line"));

  const payload = usePayload();
  const catalog = useCatalog();
  const rates = useRates();
  const batches = useBatches();
  const [tab, setTab] = useState<Tab>("products");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [rateId, setRateId] = useState<string | null>(null);
  const [newRate, setNewRate] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const detail = useRateDetail(rateId);

  const refreshAll = useCallback(() => {
    payload.refresh();
    catalog.refresh();
    rates.refresh();
    batches.refresh();
  }, [payload, catalog, rates, batches]);

  /** Closing the rate drawer and opening a panel (or the reverse) stays 1-at-a-time. */
  const openOverlay = (next: Overlay) => {
    setRateId(null);
    setNewRate(false);
    setOverlay(next);
  };
  const openRate = (id: string) => {
    setOverlay(null);
    setNewRate(false);
    setRateId(id);
  };
  const openNewRate = () => {
    setOverlay(null);
    setRateId(null);
    setNewRate(true);
    setTab("rates");
  };

  const onExport = async () => {
    setExporting(true);
    setToast(null);
    try {
      const name = await downloadKypSchema();
      setToast(`Downloaded ${name}`);
    } catch (e) {
      setToast(String((e as any)?.message ?? "export failed"));
    } finally {
      setExporting(false);
    }
  };

  const products = catalog.products;
  const stats = useMemo(() => {
    const specCount = products.reduce((n, p) => n + Object.keys(p.props).length, 0);
    return {
      products: products.length,
      specs: specCount,
      required: products.reduce((n, p) => n + p.required.length, 0),
      vendors: payload.data?.vendors?.length ?? 0,
      rates: payload.data?.rateTotal ?? 0,
    };
  }, [products, payload.data]);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-lg md:text-xl font-extrabold tracking-tight text-[var(--text-primary)]">Product Line</h1>
          <p className="text-[11px] text-[var(--text-tertiary)]">
            Vendor quotes + the KYP catalogue they typecheck against — edit anything, export the schema anytime.
          </p>
        </div>

        {/* One aligned action cluster: primary action, then the data tools. */}
        <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
          {canEdit ? (
            <button type="button" className={primaryBtn} onClick={openNewRate}>
              <Plus size={13} /> New rate
            </button>
          ) : null}
          <span className="mx-0.5 h-5 w-px bg-[var(--border-card)]" aria-hidden />
          <button
            type="button"
            className={ghostBtn}
            onClick={() => openOverlay("batches")}
            title="Every bulk paste, with the option to undo it"
          >
            <History size={13} /> Batch log
            {batches.batches.length ? (
              <span className="ml-0.5 px-1 rounded bg-[var(--bg-input)] text-[9.5px] font-bold tabular-nums">
                {batches.batches.length}
              </span>
            ) : null}
          </button>
          <button type="button" className={ghostBtn} onClick={() => void onExport()} disabled={exporting} title="Download the KYP JSON built from this catalogue">
            <Download size={13} /> {exporting ? "Building…" : "KYP JSON"}
          </button>
          <button type="button" className={ghostBtn} onClick={() => openOverlay("prompt")} title="Prompt for a chat agent that turns vendor sheets into typed rates">
            <MessageSquareCode size={13} /> Copy prompt
          </button>
          {canEdit ? (
            <button type="button" className={ghostBtn} onClick={() => openOverlay("import")} title="Paste the agent's JSON and review it before it lands">
              <ClipboardPaste size={13} /> Paste AI rates
            </button>
          ) : null}
          <span className="mx-0.5 h-5 w-px bg-[var(--border-card)]" aria-hidden />
          <button
            type="button"
            onClick={refreshAll}
            title="Reload catalogue, quotes and batches"
            aria-label="Refresh"
            className="inline-flex items-center justify-center h-8 w-8 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-input)]"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {[
          { icon: Package, label: "Products", value: stats.products, hint: `${stats.specs} specs` },
          { icon: Package, label: "Required specs", value: stats.required, hint: "across the catalogue" },
          { icon: Users, label: "Vendors", value: stats.vendors, hint: "supplier master" },
          { icon: Wallet, label: "Vendor rates", value: stats.rates, hint: "quotes on file" },
          { icon: Wallet, label: "Bulk pastes", value: batches.batches.length, hint: "traceable batches" },
        ].map(({ icon: Icon, label, value, hint }) => (
          <div key={label} className={`${panel} px-3 py-2.5`}>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
              <Icon size={11} /> {label}
            </div>
            <div className="text-lg font-extrabold tabular-nums text-[var(--text-primary)]">
              {value == null ? fmtINR(null) : Number(value).toLocaleString("en-IN")}
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)]">{hint}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--border-card)]">
        {(["products", "vendors", "rates"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-bold capitalize border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-brand-indigo text-[var(--text-primary)]"
                : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {t}
            {t === "rates" && stats.rates ? <span className="ml-1.5 text-[10px] text-[var(--text-tertiary)]">{stats.rates.toLocaleString("en-IN")}</span> : null}
            {t === "products" && stats.products ? <span className="ml-1.5 text-[10px] text-[var(--text-tertiary)]">{stats.products}</span> : null}
          </button>
        ))}
        {toast ? <span className="ml-auto pb-1 text-[11px] font-semibold text-[var(--text-tertiary)]">{toast}</span> : null}
      </div>

      {tab === "products" ? (
        <ProductsTab
          payload={payload.data}
          catalog={catalog.data}
          loading={payload.loading && catalog.loading}
          canEdit={canEdit}
          onChanged={refreshAll}
          onExport={() => void onExport()}
          exporting={exporting}
        />
      ) : null}

      {tab === "vendors" ? (
        <VendorsTab
          vendors={payload.data?.vendors ?? []}
          loading={payload.loading}
          canEdit={canEdit}
          onChanged={refreshAll}
        />
      ) : null}

      {tab === "rates" ? (
        <RatesSheet
          rates={rates}
          catalog={catalog.data}
          payload={payload.data}
          vendors={payload.data?.vendors ?? []}
          canEdit={canEdit}
          onOpen={openRate}
        />
      ) : null}

      {overlay === "prompt" ? (
        <PromptDrawer
          canEdit={canEdit}
          onClose={() => setOverlay(null)}
          onExport={() => void onExport()}
          onImport={() => openOverlay("import")}
        />
      ) : null}

      {overlay === "import" ? (
        <RateImporter
          vendors={payload.data?.vendors ?? []}
          onClose={() => setOverlay(null)}
          onChanged={refreshAll}
          onCopyPrompt={() => openOverlay("prompt")}
          onOpenBatches={() => openOverlay("batches")}
        />
      ) : null}

      {overlay === "batches" ? (
        <BatchLogDrawer
          canEdit={canEdit}
          onClose={() => setOverlay(null)}
          onChanged={refreshAll}
          onViewRates={(batchId) => {
            setOverlay(null);
            setTab("rates");
            rates.patchAndRun({ batchId });
          }}
        />
      ) : null}

      {rateId || newRate ? (
        <RateDrawer
          rateId={newRate ? null : rateId}
          rate={detail.data?.rate ?? null}
          product={detail.data?.product ?? null}
          products={products}
          vendors={payload.data?.vendors ?? []}
          loading={!newRate && detail.loading}
          canEdit={canEdit}
          onClose={() => { setRateId(null); setNewRate(false); }}
          onChanged={refreshAll}
        />
      ) : null}
    </div>
  );
}
