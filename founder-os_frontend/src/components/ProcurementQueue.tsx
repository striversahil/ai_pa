"use client";

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useEnquiryData } from "@/hooks/useEnquiryData";
import { useLiveEvent } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import ProcurementItemCard from "@/components/ProcurementItemCard";
import ProcurementThread from "@/components/ProcurementThread";
import Modal from "@/components/Modal";
import Lightbox from "@/components/Lightbox";
import { Table, thClass, tdClass } from "@/components/ui/Table";
import { ClosedDropdown } from "@/components/QueueGroups";
import type { Enquiry, EnquiryItem, EnquiryItemRate } from "@/types";
import { enquiryLabel, historyDateChip } from "@/types";
import { itemNeedsRates, isProcurementPendingEnquiry, isProcurementHistoryEnquiry, isSubmitted, isFreshQuotableItem, procurementSubmittable } from "@/enquiry/queue";

/** Pending = items still needing rates. Empty enquiries (no items yet) wait
 *  on sales, not procurement — they render in their own section below. */
export function isProcurementPending(e: Enquiry): boolean {
  return isProcurementPendingEnquiry(e);
}

const byNewest = (a: Enquiry, b: Enquiry): number =>
  String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));

const fmtDate = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

type EnquiryList = Enquiry[];

function EnquiryStatus({ enquiry, mode }: { enquiry: Enquiry; mode: "active" | "history" }) {
  const items = enquiry.items ?? [];
  if (mode === "history") {
    const n = items.filter((it) => (it.rates ?? []).length > 0 && !it.ratesRequested).length;
    return (
      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
        {n} quoted
      </span>
    );
  }
  const pendingItems = items.filter(itemNeedsRates);
  const flagged = pendingItems.filter((it) => it.specIssue).length;
  const requested = pendingItems.filter((it) => it.ratesRequested && !it.specIssue).length;
  const alternates = items.filter((it) => String((it as any)?.variationRequest ?? "").trim()).length;
  if (alternates > 0) {
    return (
      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30">
        Alternate requested{items.length > 1 ? ` (${alternates}/${items.length})` : ""}
      </span>
    );
  }
  if (flagged > 0) {
    return (
      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-red-500/10 text-red-500 border-red-500/30">
        Awaiting sales fix{pendingItems.length > 1 ? ` (${flagged}/${pendingItems.length})` : ""}
      </span>
    );
  }
  if (requested > 0) {
    return (
      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-indigo-500/10 text-indigo-500 border-indigo-500/30">
        Rates requested{pendingItems.length > 1 ? ` (${requested}/${pendingItems.length})` : ""}
      </span>
    );
  }
  if (pendingItems.length === 0 && procurementSubmittable(enquiry).ok) {
    return (
      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
        Quoted — ready to conclude
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
      Needs rates{pendingItems.length > 1 ? ` (${pendingItems.length})` : ""}
    </span>
  );
}

// Procurement Queue dashboard (mounted as the `enquiry-procurement`
// automation). Pending-only, PII-redacted, TABULAR: one row per enquiry with
// a click-to-open modal carrying the complete information (all items with
// spec, attachments, given rates, add/edit, incorrect-spec). History below,
// read-only and date-wise.
export default function ProcurementQueue() {
  const { me } = useAuth();
  const scopes = me?.scopes ?? [];
  const allowed = !!me && (me.isAdmin || scopes.includes("mis") || scopes.includes("procurement"));
  // Handle-internally is removed: everything flows through this queue.
  // Legacy internal rows still render their badge; no new flags settable.
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  // Single enquiry modal: opening an enquiry shows ALL its items (rates,
  // forms, flags) together — never one modal per item.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { enquiries, loaded, aiConfigured, updateItems, updateEnquiry, comments, addComment, currentAgent } =
    useEnquiryData("procurement");

  // Live intimations: management rate-requests (act on the item) and sales
  // spec fixes (flagged item reshared with corrections/reference media).
  const [toast, setToast] = useState<{ id: string; label: string; title: string; kind: "request" | "fixed" } | null>(null);
  const requestedRef = useRef<Record<string, number>>({});
  const flaggedRef = useRef<Record<string, number>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    if (!loaded) return;
    for (const e of enquiries) {
      if (requestedRef.current[e.id] === undefined) requestedRef.current[e.id] = (e.items ?? []).filter((it) => it.ratesRequested).length;
      if (flaggedRef.current[e.id] === undefined) flaggedRef.current[e.id] = (e.items ?? []).filter((it) => it.specIssue).length;
    }
  }, [loaded, enquiries]);
  useLiveEvent((e: any) => {
    // Scope-safe: live events carry summaries only (counts, no PII). The
    // redacted payload itself refetches in useEnquiryData — this is toast-only.
    if (!e || e.type !== "enquiries") return;
    const s = e.summary ?? e.enquiry;
    if (!s) return;
    const id = String(s.id ?? e.id ?? e.enquiryId ?? "");
    if (!id) return;
    const raw = e.enquiry ?? {};
    const label = enquiryLabel({ dailyNo: s.dailyNo ?? null, createdAt: s.createdAt ?? "", source: s.source ?? "TL" });
    const title = String(s.title || "Untitled enquiry");
    const requested = typeof s.requestedCount === "number"
      ? s.requestedCount
      : ((raw.items ?? []) as any[]).filter((it) => it?.ratesRequested).length;
    if (requestedRef.current[id] !== undefined && requested > requestedRef.current[id]) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({ id, label, title, kind: "request" });
      toastTimer.current = setTimeout(() => setToast(null), 10000);
    }
    requestedRef.current[id] = requested;
    const flagged = typeof s.flaggedCount === "number"
      ? s.flaggedCount
      : ((raw.items ?? []) as any[]).filter((it) => it?.specIssue).length;
    if (flaggedRef.current[id] !== undefined && flagged < flaggedRef.current[id]) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({ id, label, title, kind: "fixed" });
      toastTimer.current = setTimeout(() => setToast(null), 10000);
    }
    flaggedRef.current[id] = flagged;
  });

  const pending = useMemo(() => enquiries.filter(isProcurementPending).sort(byNewest), [enquiries]);
  // Total unrated-item count for the header badge (table itself stays one
  // row per enquiry — item detail lives in the modal).
  const pendingItemsCount = useMemo(
    () => pending.reduce((n, e) => n + (e.items ?? []).filter(itemNeedsRates).length, 0),
    [pending],
  );
  // History: quoted and settled — disjoint from pending, so a partially
  // quoted enquiry never appears twice. Per enquiry, so a rate-available
  // (unrated) sibling never hides quoted items.
  const byActivity = (a: Enquiry, b: Enquiry): number =>
    String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? ""));
  const historyEnquiries: EnquiryList = useMemo(() => {
    return [...enquiries].filter(isProcurementHistoryEnquiry).sort(byActivity);
  }, [enquiries]);
  // History search + pagination (client/EST/item/vendor)
  const [historySearch, setHistorySearch] = useState("");
  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return historyEnquiries;
    const qDigits = q.replace(/\D/g, "");
    return historyEnquiries.filter(e => {
      const hay = [
        e.clientCompany ?? "", e.title ?? "", e.estNumber ?? "", (e as any).enquiryNumber ?? "", (e as any).sourceLead ?? "", (e as any).location ?? "",
        e.contactName ?? "", (e as any).contactEmail ?? "", e.contactPhone ?? "", e.description ?? "", e.source ?? "", String(e.dailyNo ?? ""),
        ...((e.items ?? []) as any[]).flatMap((it:any)=> [it?.name ?? "", it?.qty ?? "", it?.spec ?? "", it?.verbatim ?? "", ...((it?.rates ?? []).map((r:any)=> r?.vendor ?? ""))]),
      ].join(" ").toLowerCase();
      if (hay.includes(q)) return true;
      if (qDigits.length >= 3 && (e.estNumber ?? "").replace(/\D/g,"").includes(qDigits)) return true;
      return false;
    });
  }, [historyEnquiries, historySearch]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState<number>(50);
  const PAGE_SIZE_OPTIONS = [50, 100, 200] as const;
  useEffect(() => { setHistoryPage(1); }, [filteredHistory.length, historyPageSize, historySearch]);
  const historyTotalPages = Math.max(1, Math.ceil(filteredHistory.length / historyPageSize));
  const historyPageClamped = Math.min(historyPage, historyTotalPages);
  const visibleHistory = useMemo(() => filteredHistory.slice((historyPageClamped - 1) * historyPageSize, historyPageClamped * historyPageSize), [filteredHistory, historyPageClamped, historyPageSize]);
  const emptyEnquiries = useMemo(
    () => [...enquiries].filter((e) => (e.items ?? []).length === 0).sort(byNewest),
    [enquiries],
  );
  // Enquiry-level requirements grouped by enquiry (legacy rows; new adds land
  // as items). Served text is the AI-redacted copy (withheld while pending).
  const reqGroups = useMemo(() => enquiries
    .map((e) => ({
      enquiry: e,
      reqs: (e.additionalRequirements ?? []).filter((r) => {
        const t = typeof r === "string" ? r : r?.text;
        return t && String(t).trim().length > 0;
      }),
    }))
    .filter((g) => g.reqs.length > 0)
    .sort((a, b) => byNewest(a.enquiry, b.enquiry)), [enquiries]);

  const handleOpenLightbox = useCallback((url: string, list?: string[], idx?: number) => {
    const images = Array.isArray(list) && list.length > 0 ? list.filter(Boolean) : [url].filter(Boolean);
    if (images.length === 0) return;
    const index = typeof idx === "number" && images[idx] ? idx : Math.max(0, images.indexOf(url));
    setLightbox({ images, index });
  }, []);

  const patchItems = useCallback(async (
    enquiryId: string,
    fn: (items: EnquiryItem[]) => EnquiryItem[],
  ) => {
    setSaveError(null);
    try {
      // Procurement surface: privileged writers acting here stamp Procurement
      // (not Management), and attaching photos never clears the spec flag.
      await updateItems(enquiryId, fn, "procurement");
    } catch (e: any) {
      setSaveError(e?.message || "Save failed — please retry.");
    }
  }, [updateItems]);

  const handleAddRate = useCallback((enquiryId: string, itemIdx: number, rate: EnquiryItemRate) =>
    void patchItems(enquiryId, (items) => items.map((it, i) =>
      i === itemIdx ? { ...it, rates: [...(it.rates ?? []), rate] } : it)), [patchItems]);

  const handleEditRate = useCallback((enquiryId: string, itemIdx: number, rateIdx: number, rate: EnquiryItemRate) =>
    void patchItems(enquiryId, (items) => items.map((it, i) =>
      i === itemIdx ? { ...it, rates: (it.rates ?? []).map((r, j) => (j === rateIdx ? rate : r)) } : it)), [patchItems]);

  const handleRemoveRate = useCallback((enquiryId: string, itemIdx: number, rateIdx: number) =>
    void patchItems(enquiryId, (items) => items.map((it, i) =>
      i === itemIdx ? { ...it, rates: (it.rates ?? []).filter((_, j) => j !== rateIdx) } : it)), [patchItems]);

  const handleFlag = useCallback((enquiryId: string, itemIdx: number, reason: string) =>
    void patchItems(enquiryId, (items) => items.map((it, i) =>
      i === itemIdx ? { ...it, specIssue: reason, specFlaggedAt: new Date().toISOString() } : it)), [patchItems]);

  const handleAddItemMedia = useCallback((enquiryId: string, itemIdx: number, media: EnquiryItem["media"]) =>
    void patchItems(enquiryId, (items) => items.map((it, i) =>
      i === itemIdx ? { ...it, media: [...(it.media ?? []), ...(media ?? [])] } : it)), [patchItems]);

  // Enquiry Concluded: explicit procurement handoff — enquiry stays Active
  // (quoted) until this is clicked; management sees live rates the whole
  // time via the live predicate, this just marks the enquiry done.
  const handleSubmit = useCallback(async (enquiryId: string) => {
    setSaveError(null);
    try {
      await updateEnquiry(enquiryId, { procurementSubmittedAt: new Date().toISOString() });
      setSelectedId(null);
    } catch (e: any) {
      setSaveError(e?.message || "Conclude failed — please retry.");
    }
  }, [updateEnquiry]);

  if (!allowed) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm font-semibold text-zinc-500 dark:text-zinc-400">
        Procurement access only.
      </div>
    );
  }

  if (!loaded) {
    return <div className="flex min-h-[50vh] items-center justify-center text-zinc-500 animate-pulse">Loading queue…</div>;
  }

  const selEnquiry = selectedId ? enquiries.find((e) => e.id === selectedId) ?? null : null;

  // One row per enquiry — item names/rates aggregate in the row, full
  // item detail (spec, attachments, rate forms) lives in the modal.
  const renderEnquiryRows = (list: Enquiry[], mode: "active" | "history") => list.map((e) => {
    const items = e.items ?? [];
    const quoted = items.filter((it) => (it.rates ?? []).length > 0).length;
    const needRatesActive = items.filter(itemNeedsRates).length;
    const isReady = mode === "active" && needRatesActive === 0 && procurementSubmittable(e).ok;
    const needRates = mode === "active"
      ? needRatesActive
      : items.filter((it) => (it.rates ?? []).length > 0 && !it.ratesRequested).length;
    const names = items.map((it, i) => {
      const n = it.name || `Item ${i + 1}`;
      return it.qty ? `${n} × ${it.qty}` : n;
    });
    const shown = names.slice(0, 3).join(" · ");
    const rest = names.length > 3 ? ` +${names.length - 3} more` : "";
    return (
      <tr
        key={e.id}
        onClick={() => setSelectedId(e.id)}
        className="cursor-pointer transition-colors hover:bg-[var(--bg-input)]/40"
      >
        <td className={tdClass}>
          <span className="text-[11px] font-extrabold text-[var(--color-brand-indigo)] whitespace-nowrap">{enquiryLabel(e)}</span>
          <span className="block text-[11px] text-[var(--text-tertiary)] truncate max-w-[14rem]">{e.title || "Untitled"}</span>
        </td>
        <td className={tdClass}>
          <span className="font-bold text-[var(--text-primary)]">{items.length} item{items.length === 1 ? "" : "s"}</span>
          {shown && (
            <span className="block text-[11px] text-[var(--text-secondary)] truncate max-w-[22rem]">{shown}{rest}</span>
          )}
        </td>
        <td className={tdClass}>
          <span className="text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
            {mode === "active" ? (isReady ? `Ready to conclude` : `${needRates} need rates`) : `${needRates} quoted`}
            <span className="text-[var(--text-tertiary)]"> · {quoted}/{items.length} with rates</span>
          </span>
        </td>
        <td className={tdClass}><EnquiryStatus enquiry={e} mode={mode} /></td>
        <td className={tdClass}>
          <span className="text-[11px] text-[var(--text-tertiary)]">{historyDateChip(e.updatedAt ?? e.createdAt) || "—"}</span>
        </td>
      </tr>
    );
  });

  const isEmpty = pending.length === 0 && reqGroups.length === 0 && historyEnquiries.length === 0;

  const enquiryTable = (list: Enquiry[], mode: "active" | "history") => (
    <Table stickyFirst>
      <thead>
        <tr>
          <th className={thClass}>Enquiry</th>
          <th className={thClass}>Items</th>
          <th className={thClass}>Rates</th>
          <th className={thClass}>Status</th>
          <th className={thClass}>Updated</th>
        </tr>
      </thead>
      <tbody>{renderEnquiryRows(list, mode)}</tbody>
    </Table>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading text-zinc-900 dark:text-white">Procurement Queue</h1>
        <span className="px-3 py-1 text-xs font-extrabold rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
          {pending.length} enquir{pending.length === 1 ? "y" : "ies"} · {pendingItemsCount} item{pendingItemsCount === 1 ? "" : "s"} pending
        </span>
      </div>
      {saveError && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs font-bold text-red-500">{saveError}</p>
      )}
      {!aiConfigured && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-600 dark:text-amber-400">
          AI redaction is offline — item specs and vendor rates below are live, but client details are withheld until the AI service recovers.
        </p>
      )}

      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl border p-4 shadow-2xl animate-scale-up bg-[var(--bg-card)] ${
          toast.kind === "request" ? "border-indigo-500/40" : "border-emerald-500/40"
        }`}>
          <div className="flex items-start gap-3">
            <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-base ${
              toast.kind === "request" ? "bg-indigo-500/15" : "bg-emerald-500/15"
            }`}>{toast.kind === "request" ? "📩" : "✅"}</span>
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-extrabold ${toast.kind === "request" ? "text-indigo-500" : "text-emerald-600 dark:text-emerald-400"}`}>
                {toast.kind === "request" ? "Management requested more rates" : "Spec fixed — item reshared"}
              </p>
              <p className="truncate text-sm font-bold text-[var(--text-primary)]">{toast.title}</p>
              <p className="text-[11px] font-semibold text-[var(--color-brand-indigo)]">{toast.label}</p>
              <button type="button" onClick={() => setToast(null)}
                className="mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer border-0 bg-transparent">
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {isEmpty ? (
        <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-10 text-center">
          <p className="text-lg font-bold text-[var(--text-primary)]">Queue clear 🎉</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Every item has vendor rates. New unrated items will appear here automatically.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
                Active — needs rates ({pending.length} enquir{pending.length === 1 ? "y" : "ies"})
              </p>
              {enquiryTable(pending, "active")}
            </section>
          )}

          {emptyEnquiries.length > 0 && (
            <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4 space-y-2">
              <p className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
                Enquiries with no items yet ({emptyEnquiries.length})
              </p>
              {emptyEnquiries.map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <span className="font-extrabold text-[var(--color-brand-indigo)]">{enquiryLabel(e)}</span>
                  <span className="font-semibold text-[var(--text-primary)]">{e.title || "Untitled enquiry"}</span>
                  {fmtDate(e.createdAt) && <span className="text-[var(--text-tertiary)]">· {fmtDate(e.createdAt)}</span>}
                  <span className="text-[var(--text-tertiary)]">— waiting on sales to add items</span>
                </div>
              ))}
            </div>
          )}

          {historyEnquiries.length > 0 && (
            <ClosedDropdown count={historyEnquiries.length}>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10 18a8 8 0 110-16 8 8 0 010 16z" /></svg>
                  <input value={historySearch} onChange={(e)=> setHistorySearch(e.target.value)} placeholder="Search client, EST No., title, item, vendor…" className="w-full pl-8 pr-3 py-2 rounded-xl bg-[var(--bg-input)] border border-[var(--border-card)] text-xs focus:outline-none focus:border-brand-indigo" />
                  {historySearch && <button type="button" onClick={()=> setHistorySearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs">×</button>}
                </div>
                {historySearch && <span className="text-xs text-[var(--text-secondary)]">{filteredHistory.length} match</span>}
              </div>
              {enquiryTable(visibleHistory, "history")}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 border-t border-[var(--border-card)] mt-3">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">Showing {filteredHistory.length ? (historyPageClamped - 1) * historyPageSize + 1 : 0}–{Math.min(historyPageClamped * historyPageSize, filteredHistory.length)} of {filteredHistory.length} {historyTotalPages > 1 ? `· page ${historyPageClamped} of ${historyTotalPages}` : ""}</span>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">Show</label>
                  <select value={historyPageSize} onChange={(e) => setHistoryPageSize(Number(e.target.value))} className="px-2 py-1 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg text-xs font-semibold cursor-pointer">
                    {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} / page</option>)}
                  </select>
                  <button type="button" disabled={historyPageClamped <= 1} onClick={() => setHistoryPage(historyPageClamped - 1)} className="px-2.5 py-1 rounded-lg border border-[var(--border-card)] text-xs font-bold disabled:opacity-40 cursor-pointer">‹ Prev</button>
                  <button type="button" disabled={historyPageClamped >= historyTotalPages} onClick={() => setHistoryPage(historyPageClamped + 1)} className="px-2.5 py-1 rounded-lg border border-[var(--border-card)] text-xs font-bold disabled:opacity-40 cursor-pointer">Next ›</button>
                </div>
              </div>
            </ClosedDropdown>
          )}

          {reqGroups.length > 0 && (
            <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4 space-y-3">
              <p className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
                Additional requirements ({reqGroups.reduce((n, g) => n + g.reqs.length, 0)})
              </p>
              {reqGroups.map(({ enquiry: e, reqs }) => (
                <div key={e.id} className="space-y-1.5">
                  <p className="text-xs font-bold text-[var(--text-primary)]">
                    <span className="font-extrabold text-[var(--color-brand-indigo)]">{enquiryLabel(e)}</span>
                    {" · "}{e.title || "Untitled enquiry"}
                    {(e as any).redactedPending && (
                      <span className="ml-2 font-semibold text-zinc-500">· newest requirement processing…</span>
                    )}
                  </p>
                  <ul className="space-y-1.5">
                    {reqs.map((r, i) => {
                      const text = typeof r === "string" ? r : String(r?.text ?? "");
                      const img = typeof r === "string" ? undefined : r?.imageUrl;
                      return (
                        <li key={i} className="flex items-start gap-2.5 text-xs text-[var(--text-secondary)] font-medium bg-[var(--bg-input)]/25 p-2.5 rounded-lg border border-[var(--border-card)]/50">
                          {img && (
                            <img src={img} alt="Requirement attachment"
                              className="w-14 h-14 rounded-lg object-cover border border-[var(--border-card)] cursor-zoom-in flex-shrink-0"
                              onClick={() => setLightbox({ images: [img], index: 0 })} />
                          )}
                          <span className="pt-1 whitespace-pre-wrap">{text}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selEnquiry && (
        <Modal
          title={`${enquiryLabel(selEnquiry)} · ${selEnquiry.title || "Untitled enquiry"}`}
          subtitle={`${(selEnquiry.items ?? []).length} item${(selEnquiry.items ?? []).length === 1 ? "" : "s"} — vendors, bulk view, flags in one place`}
          onClose={() => setSelectedId(null)}
          wide
        >
          {(selEnquiry as any).redactedPending && (
            <p className="text-[11px] font-semibold text-zinc-500">Details processing — refreshes live.</p>
          )}
          {(() => {
            const submitted = isSubmitted(selEnquiry);
            const lateQuoteEnquiry = selEnquiry.rateStatus === "finalized";
            const freshCount = (selEnquiry.items ?? []).filter(isFreshQuotableItem).length;
            if (submitted && freshCount > 0) {
              return (
                <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                  {freshCount} item{freshCount === 1 ? "" : "s"} still need{freshCount === 1 ? "s" : ""} quotes — decided lines stay locked, quote only the open {freshCount === 1 ? "line" : "lines"} below.
                </p>
              );
            }
            if (submitted && !lateQuoteEnquiry) {
              return (
                <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                  Enquiry Concluded — vendor rates locked. Management sees the live quotes already; late quotes reopen via a management rate request.
                </p>
              );
            }
            if (submitted && lateQuoteEnquiry) {
              return (
                <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                  Finalized — new vendor quotes are welcome here; decided rates stay until management revises.
                </p>
              );
            }
            const gate = procurementSubmittable(selEnquiry);
            return (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-card)] bg-[var(--bg-input)]/25 px-3 py-2">
                <button
                  type="button"
                  disabled={!gate.ok}
                  onClick={() => void handleSubmit(selEnquiry.id)}
                  title={gate.ok ? "Mark enquiry as concluded — procurement is done" : gate.reason}
                  className="px-3.5 py-2 bg-brand-indigo text-white font-bold text-xs rounded-xl cursor-pointer border-0 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Enquiry Concluded
                </button>
                {!gate.ok && (
                  <span className="text-[11px] font-semibold text-[var(--text-tertiary)]">{gate.reason} — the enquiry stays in Active (and management sees live rates) until you conclude.</span>
                )}
              </div>
            );
          })()}
          <div className="space-y-2.5">
            {(() => {
              const submitted = isSubmitted(selEnquiry);
              const lateQuoteEnquiry = selEnquiry.rateStatus === "finalized";
              const all = selEnquiry.items ?? [];
              const hidden = all.filter((it) => it.rateAvailable || (it as any).internalRates).length;
              const visible = all.map((it, idx) => ({ it, idx })).filter(({ it }) => !it.rateAvailable && !(it as any).internalRates);
              return (
                <>
                  {hidden > 0 && (
                    <p className="rounded-xl border border-zinc-700/50 bg-zinc-800/40 px-3 py-2 text-[11px] font-semibold text-zinc-400">
                      {hidden} item{hidden === 1 ? "" : "s"} marked rate available — hidden from procurement (only {visible.length} needing rates shown).
                    </p>
                  )}
                  {visible.length === 0 ? (
                    <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      All items are rate available — nothing to quote. Conclude when ready.
                    </p>
                  ) : (
                    visible.map(({ it: item, idx: itemIdx }) => (
                      <ProcurementItemCard
                        key={itemIdx}
                        item={item}
                        itemIdx={itemIdx}
                        lateQuote={lateQuoteEnquiry}
                        onAddRate={(rate) => handleAddRate(selEnquiry.id, itemIdx, rate)}
                        onEditRate={(ri, rate) => handleEditRate(selEnquiry.id, itemIdx, ri, rate)}
                        onRemoveRate={(ri) => handleRemoveRate(selEnquiry.id, itemIdx, ri)}
                        onFlag={(reason) => handleFlag(selEnquiry.id, itemIdx, reason)}
                        onOpenLightbox={handleOpenLightbox}
                        onAddItemMedia={(media) => handleAddItemMedia(selEnquiry.id, itemIdx, media)}
                        readOnly={(submitted && !isFreshQuotableItem(item) && !(item as any).variationRequest) || (item.finalRate !== undefined && item.finalRate !== null && !(item as any).variationRequest)}
                      />
                    ))
                  )}
                </>
              );
            })()}
            <ProcurementThread
              enquiryId={selEnquiry.id}
              comments={comments}
              currentAgentId={String(currentAgent?.id ?? "")}
              onAddComment={(c) => void addComment(c)}
            />
          </div>
        </Modal>
      )}

      {lightbox && (
        <Lightbox
          images={lightbox.images}
          initialIndex={lightbox.index}
          image={null}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
