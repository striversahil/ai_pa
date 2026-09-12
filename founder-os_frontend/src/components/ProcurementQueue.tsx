"use client";

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useEnquiryData } from "@/hooks/useEnquiryData";
import { useLiveEvent } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import ProcurementItemCard from "@/components/ProcurementItemCard";
import Modal from "@/components/Modal";
import Lightbox from "@/components/Lightbox";
import { Table, thClass, tdClass } from "@/components/ui/Table";
import { ClosedDropdown } from "@/components/QueueGroups";
import type { Enquiry, EnquiryItem, EnquiryItemRate } from "@/types";
import { enquiryLabel, historyDateChip, itemNeedsRates } from "@/types";

/** Only rate-UNAVAILABLE items flow through this queue — status-blind, so a
 *  finalized enquiry with a newly added unrated item reappears automatically.
 *  Flagged items (held for a sales spec fix) count as present but need no rates. */
export function isProcurementPending(e: Enquiry): boolean {
  const items = e.items ?? [];
  return items.length === 0 || items.some(itemNeedsRates);
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
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  // Single enquiry modal: opening an enquiry shows ALL its items (rates,
  // forms, flags) together — never one modal per item.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { enquiries, loaded, updateItems } =
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
    if (!e || e.type !== "enquiries" || !e.enquiry) return;
    const id = String(e.enquiry.id ?? "");
    if (!id) return;
    const raw = e.enquiry;
    const label = enquiryLabel({ dailyNo: raw.dailyNo ?? null, createdAt: raw.createdAt ?? "", source: raw.source ?? "TL" });
    const title = String(raw.title || "Untitled enquiry");
    const requested = ((raw.items ?? []) as any[]).filter((it) => it?.ratesRequested).length;
    if (requestedRef.current[id] !== undefined && requested > requestedRef.current[id]) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({ id, label, title, kind: "request" });
      toastTimer.current = setTimeout(() => setToast(null), 10000);
    }
    requestedRef.current[id] = requested;
    const flagged = ((raw.items ?? []) as any[]).filter((it) => it?.specIssue).length;
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
  // History: enquiries with at least one quoted item and no open request —
  // per enquiry, so a rate-available (unrated) sibling never hides quoted items.
  const byActivity = (a: Enquiry, b: Enquiry): number =>
    String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? ""));
  const historyEnquiries: EnquiryList = useMemo(() => {
    return [...enquiries]
      .filter((e) => (e.items ?? []).some((item) => (item.rates ?? []).length > 0 && !item.ratesRequested))
      .sort(byActivity);
  }, [enquiries]);
  const emptyEnquiries = useMemo(
    () => pending.filter((e) => (e.items ?? []).length === 0),
    [pending],
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
      await updateItems(enquiryId, fn);
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
    const needRates = mode === "active"
      ? items.filter(itemNeedsRates).length
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
            {mode === "active" ? `${needRates} need rates` : `${needRates} quoted`}
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
              {enquiryTable(historyEnquiries, "history")}
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
          <div className="space-y-2.5">
            {(selEnquiry.items ?? []).map((item, itemIdx) => (
              <ProcurementItemCard
                key={itemIdx}
                item={item}
                itemIdx={itemIdx}
                onAddRate={(rate) => handleAddRate(selEnquiry.id, itemIdx, rate)}
                onEditRate={(ri, rate) => handleEditRate(selEnquiry.id, itemIdx, ri, rate)}
                onRemoveRate={(ri) => handleRemoveRate(selEnquiry.id, itemIdx, ri)}
                onFlag={(reason) => handleFlag(selEnquiry.id, itemIdx, reason)}
                onOpenLightbox={handleOpenLightbox}
                readOnly={item.finalRate !== undefined && item.finalRate !== null}
              />
            ))}
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
