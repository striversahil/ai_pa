"use client";

import React, { useState, useCallback, useMemo } from "react";
import { useEnquiryData } from "@/hooks/useEnquiryData";
import { useAuth } from "@/auth/AuthContext";
import ProcurementItemCard from "@/components/ProcurementItemCard";
import Modal from "@/components/Modal";
import Lightbox from "@/components/Lightbox";
import { Table, thClass, tdClass } from "@/components/ui/Table";
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

type ItemRow = { enquiry: Enquiry; item: EnquiryItem; itemIdx: number };

function ItemStatus({ item }: { item: EnquiryItem }) {
  const n = (item.rates ?? []).length;
  if (item.specIssue) {
    return (
      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-red-500/10 text-red-500 border-red-500/30">
        Awaiting sales fix
      </span>
    );
  }
  if (n === 0) {
    return (
      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
        Needs rates
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-zinc-500/10 text-zinc-500 border-zinc-500/30">
      {n} rate{n === 1 ? "" : "s"}
    </span>
  );
}

// Procurement Queue dashboard (mounted as the `enquiry-procurement`
// automation). Pending-only, PII-redacted, TABULAR: one row per item with a
// click-to-open rates modal carrying the complete information (spec,
// attachments, given rates, add/edit, incorrect-spec). History below,
// read-only and date-wise.
export default function ProcurementQueue() {
  const { me } = useAuth();
  const scopes = me?.scopes ?? [];
  const allowed = !!me && (me.isAdmin || scopes.includes("mis") || scopes.includes("procurement"));
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [selected, setSelected] = useState<{ enquiryId: string; itemIdx: number; readOnly: boolean } | null>(null);

  const { enquiries, loaded, updateItems } = useEnquiryData("procurement");

  const pending = useMemo(() => enquiries.filter(isProcurementPending).sort(byNewest), [enquiries]);
  const activeRows: ItemRow[] = useMemo(() => {
    const out: ItemRow[] = [];
    for (const e of pending) {
      (e.items ?? []).forEach((item, itemIdx) => {
        if (itemNeedsRates(item)) out.push({ enquiry: e, item, itemIdx });
      });
    }
    return out;
  }, [pending]);
  // History: every item rated — already quoted, newest first.
  const byActivity = (a: Enquiry, b: Enquiry): number =>
    String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? ""));
  const historyRows: ItemRow[] = useMemo(() => {
    const done = enquiries
      .filter((e) => {
        const items = e.items ?? [];
        return items.length > 0 && items.every((it) => (it.rates ?? []).length > 0);
      })
      .sort(byActivity);
    const out: ItemRow[] = [];
    for (const e of done) (e.items ?? []).forEach((item, itemIdx) => out.push({ enquiry: e, item, itemIdx }));
    return out;
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
    await updateItems(enquiryId, fn);
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

  const selEnquiry = selected ? enquiries.find((e) => e.id === selected.enquiryId) ?? null : null;
  const selItem = selEnquiry ? (selEnquiry.items ?? [])[selected!.itemIdx] ?? null : null;

  const renderRows = (rows: ItemRow[], readOnly: boolean) => rows.map(({ enquiry: e, item, itemIdx }) => {
    const latest = (item.rates ?? []).map((r) => r.quotedAt).sort().reverse()[0];
    return (
      <tr
        key={`${e.id}-${itemIdx}`}
        onClick={() => setSelected({ enquiryId: e.id, itemIdx, readOnly })}
        className="cursor-pointer transition-colors hover:bg-[var(--bg-input)]/40"
      >
        <td className={tdClass}>
          <span className="text-[11px] font-extrabold text-[var(--color-brand-indigo)] whitespace-nowrap">{enquiryLabel(e)}</span>
          <span className="block text-[11px] text-[var(--text-tertiary)] truncate max-w-[14rem]">{e.title || "Untitled"}</span>
        </td>
        <td className={tdClass}>
          <span className="font-bold text-[var(--text-primary)]">{item.name || `Item ${itemIdx + 1}`}</span>
          {item.qty && <span className="ml-2 text-[11px] text-[var(--text-secondary)]">× {item.qty}</span>}
        </td>
        <td className="px-4 py-3 border-b border-[var(--border-card)] text-[var(--text-secondary)]">
          <span className="block text-xs max-w-[22rem] truncate">{item.spec || "—"}</span>
        </td>
        <td className={tdClass}><ItemStatus item={item} /></td>
        <td className={tdClass}>
          <span className="text-[11px] text-[var(--text-tertiary)]">{latest ? historyDateChip(latest) : "—"}</span>
        </td>
      </tr>
    );
  });

  const isEmpty = pending.length === 0 && reqGroups.length === 0 && historyRows.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading text-zinc-900 dark:text-white">Procurement Queue</h1>
        <span className="px-3 py-1 text-xs font-extrabold rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
          {activeRows.length} item{activeRows.length === 1 ? "" : "s"} pending
        </span>
      </div>

      {isEmpty ? (
        <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-10 text-center">
          <p className="text-lg font-bold text-[var(--text-primary)]">Queue clear 🎉</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Every item has vendor rates. New unrated items will appear here automatically.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {activeRows.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
                Active — needs rates ({activeRows.length})
              </p>
              <Table stickyFirst>
                <thead>
                  <tr>
                    <th className={thClass}>Enquiry</th>
                    <th className={thClass}>Item</th>
                    <th className={thClass}>Spec</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>Quoted</th>
                  </tr>
                </thead>
                <tbody>{renderRows(activeRows, false)}</tbody>
              </Table>
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

          {historyRows.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
                Rate history — already quoted ({historyRows.length})
              </p>
              <Table stickyFirst>
                <thead>
                  <tr>
                    <th className={thClass}>Enquiry</th>
                    <th className={thClass}>Item</th>
                    <th className={thClass}>Spec</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>Quoted</th>
                  </tr>
                </thead>
                <tbody>{renderRows(historyRows, true)}</tbody>
              </Table>
            </section>
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

      {selected && selEnquiry && selItem && (
        <Modal
          title={`${selItem.name || `Item ${selected.itemIdx + 1}`}${selItem.qty ? ` × ${selItem.qty}` : ""}`}
          subtitle={`${enquiryLabel(selEnquiry)} · ${selEnquiry.title || "Untitled enquiry"}`}
          onClose={() => setSelected(null)}
          wide
        >
          {(selEnquiry as any).redactedPending && (
            <p className="text-[11px] font-semibold text-zinc-500">Details processing — refreshes live.</p>
          )}
          <ProcurementItemCard
            item={selItem}
            itemIdx={selected.itemIdx}
            onAddRate={(rate) => handleAddRate(selEnquiry.id, selected.itemIdx, rate)}
            onEditRate={(ri, rate) => handleEditRate(selEnquiry.id, selected.itemIdx, ri, rate)}
            onRemoveRate={(ri) => handleRemoveRate(selEnquiry.id, selected.itemIdx, ri)}
            onFlag={(reason) => handleFlag(selEnquiry.id, selected.itemIdx, reason)}
            onOpenLightbox={handleOpenLightbox}
            readOnly={selected.readOnly}
          />
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
