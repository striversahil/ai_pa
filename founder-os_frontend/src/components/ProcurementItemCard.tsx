"use client";

import React, { useState } from "react";
import ItemRateForm from "@/components/ItemRateForm";
import FlagThread from "@/components/FlagThread";
import type { EnquiryItem, EnquiryItemRate } from "@/types";
import { historyDateChip } from "@/types";
import { filesToMedia, dragHasFiles } from "@/lib/imageFiles";

interface ProcurementItemCardProps {
  item: EnquiryItem;
  itemIdx: number;
  onAddRate: (rate: EnquiryItemRate) => void;
  onEditRate: (rateIdx: number, rate: EnquiryItemRate) => void;
  onRemoveRate: (rateIdx: number) => void;
  onFlag: (reason: string) => void;
  onOpenLightbox: (url: string, list?: string[], idx?: number) => void;
  /** Management-internal handoff (MIS-gated by the parent): mark the item
   *  for management sourcing, or return it to the procurement queue. */
  canMarkInternal?: boolean;
  onMarkInternal?: () => void;
  onUnmarkInternal?: () => void;
  /** History rendering: given rates visible, all mutation UI hidden. */
  readOnly?: boolean;
}

// One compact procurement work card: spec + attachments on top, already-given
// rates as tight rows (editable in place), add-rate and incorrect-spec forms
// collapsed behind buttons so the queue stays scannable. A flagged item shows
// its hold banner and no rate actions until Sales corrects the spec.
export default function ProcurementItemCard({
  item, itemIdx, onAddRate, onEditRate, onRemoveRate, onFlag, onOpenLightbox,
  canMarkInternal = false, onMarkInternal, onUnmarkInternal, readOnly = false,
}: ProcurementItemCardProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingRate, setEditingRate] = useState<number | null>(null);
  const [showFlag, setShowFlag] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [refError, setRefError] = useState<string | null>(null);
  const [refDropRi, setRefDropRi] = useState<number | null>(null);

  const rates = item.rates ?? [];
  const flagged = !!item.specIssue;
  const locked = item.finalRate !== undefined && item.finalRate !== null;
  const media = item.media ?? [];
  const images = media.map((m) => m.url).filter(Boolean);

  const submitFlag = () => {
    const reason = flagReason.trim();
    if (!reason) return;
    onFlag(reason);
    setFlagReason("");
    setShowFlag(false);
  };

  // Per-vendor reference attachments: each quote carries its own photos /
  // drawings / PDFs. The selected vendor's refs forward to sales with the
  // final rate; losing quotes' refs stay internal.
  const attachRateRefs = async (ri: number, files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setRefError(null);
    const { media, skipped } = await filesToMedia(files);
    if (skipped.length > 0) setRefError(`Skipped: ${skipped.join(", ")}`);
    if (media.length === 0) return;
    const cur = rates[ri];
    if (!cur) return;
    onEditRate(ri, { ...cur, references: [...(cur.references ?? []), ...media] });
  };

  const removeRateRef = (ri: number, mi: number) => {
    const cur = rates[ri];
    if (!cur) return;
    onEditRate(ri, { ...cur, references: (cur.references ?? []).filter((_, j) => j !== mi) });
  };

  return (
    <div className="rounded-xl border border-[var(--border-card)]/70 bg-[var(--bg-input)]/20 p-3 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs font-extrabold text-[var(--text-primary)]">
          Item {itemIdx + 1}{item.name ? ` — ${item.name}` : ""}
        </span>
        {item.qty && (
          <span className="text-[10px] font-bold text-[var(--text-secondary)]">Qty: {item.qty}</span>
        )}
        <span className={`ml-auto px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap ${
          flagged
            ? "bg-red-500/10 text-red-500 border-red-500/30"
            : rates.length === 0
              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
              : "bg-zinc-500/10 text-zinc-500 border-zinc-500/30"
        }`}>
          {flagged ? "Awaiting sales fix" : rates.length === 0 ? "Needs rates" : `${rates.length} rate${rates.length === 1 ? "" : "s"}`}
        </span>
        {item.rateAvailable && (
          <span className="px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-indigo-500/10 text-indigo-500 border-indigo-500/30">
            Rate available
          </span>
        )}
        {item.internalRates && (
          <span className="px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-violet-500/10 text-violet-500 border-violet-500/30">
            Internal — management
          </span>
        )}
      </div>

      {item.spec && (
        <p className="text-xs text-[var(--text-secondary)] font-medium whitespace-pre-wrap leading-relaxed">{item.spec}</p>
      )}

      {media.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {media.map((m, mi) => (
            m.type === "video" ? (
              <video key={mi} src={m.url} controls preload="metadata"
                className="w-24 h-14 rounded-lg object-cover border border-[var(--border-card)] bg-black" />
            ) : m.type === "pdf" ? (
              <a key={mi} href={m.url} download={m.name || `item-doc-${mi + 1}.pdf`}
                className="px-2 py-1.5 rounded-lg border border-[var(--border-card)] bg-red-500/10 hover:bg-red-500/20 transition-colors cursor-pointer text-[10px] font-bold text-[var(--text-primary)] truncate max-w-[10rem]">
                {m.name || "PDF"}
              </a>
            ) : (
              <img key={mi} src={m.url} alt={`Attachment ${mi + 1}`}
                className="w-12 h-12 rounded-lg object-cover border border-[var(--border-card)] cursor-zoom-in"
                onClick={() => onOpenLightbox(m.url, images.length > 0 ? images : [m.url], Math.max(0, images.indexOf(m.url)))} />
            )
          ))}
        </div>
      )}

      {flagged && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 text-[11px] leading-relaxed">
          <p className="font-extrabold text-red-500 uppercase tracking-wide text-[10px]">Incorrect spec — held from Management</p>
          <p className="mt-0.5 text-[var(--text-secondary)] whitespace-pre-wrap">{item.specIssue}</p>
          <p className="mt-1 text-[var(--text-tertiary)]">
            Flagged {historyDateChip(item.specFlaggedAt) || "recently"} · Sales edits the spec to release this item.
          </p>
        </div>
      )}

      {item.ratesRequested && (
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-2.5 text-[11px] leading-relaxed">
          <p className="font-extrabold text-indigo-500 uppercase tracking-wide text-[10px]">Management requested more vendor rates</p>
          {item.ratesRequested.trim() && (
            <p className="mt-0.5 text-[var(--text-secondary)] whitespace-pre-wrap">{item.ratesRequested}</p>
          )}
          <p className="mt-1 text-[var(--text-tertiary)]">
            Add or edit a rate below to answer — the request clears automatically.
          </p>
        </div>
      )}

      <FlagThread thread={item.thread ?? []} hideSalesRemarks />

      {rates.length > 0 && (
        <ul className="space-y-1">
          {rates.map((r, ri) => {
            const refs = r.references ?? [];
            const refImages = refs.filter((m) => m.type !== "video" && m.type !== "pdf").map((m) => m.url).filter(Boolean);
            return (
            <li key={ri}
              onDragOver={!readOnly ? (e) => { if (dragHasFiles(e)) { e.preventDefault(); if (refDropRi !== ri) setRefDropRi(ri); } } : undefined}
              onDragLeave={!readOnly ? () => { if (refDropRi === ri) setRefDropRi(null); } : undefined}
              onDrop={!readOnly ? (e) => { if (dragHasFiles(e)) { e.preventDefault(); setRefDropRi(null); void attachRateRefs(ri, e.dataTransfer.files); } } : undefined}
              className={`rounded-lg border px-2 py-1.5 transition-colors ${!readOnly && refDropRi === ri ? "border-brand-indigo bg-brand-indigo/10" : "border-[var(--border-card)]/60"}`}
            >
              {editingRate === ri ? (
                <ItemRateForm
                  initial={r}
                  submitLabel="Save"
                  onCancel={() => setEditingRate(null)}
                  onAdd={(next) => { onEditRate(ri, next); setEditingRate(null); }}
                />
              ) : (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="font-bold text-[var(--text-primary)] truncate flex-1 min-w-0">{r.vendor}</span>
                  {r.specSame === false && (
                    <span className="px-1 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wide bg-amber-500/10 text-amber-500 border border-amber-500/30 flex-shrink-0">Spec differs</span>
                  )}
                  {r.quotedAt && (
                    <span className="text-[9px] text-[var(--text-tertiary)] flex-shrink-0">{historyDateChip(r.quotedAt)}</span>
                  )}
                  <span className="font-mono text-[var(--text-secondary)] whitespace-nowrap">₹{Number(r.rate).toLocaleString("en-IN")}</span>
                  {!flagged && !readOnly && (
                    <>
                      <button type="button" onClick={() => { setEditingRate(ri); setShowAdd(false); }}
                        title="Edit rate"
                        className="text-[var(--color-brand-indigo)] hover:opacity-80 font-bold cursor-pointer bg-transparent border-0 flex-shrink-0 px-0.5">✎</button>
                      <button type="button" onClick={() => onRemoveRate(ri)}
                        title="Remove rate"
                        className="text-[var(--color-danger)] hover:opacity-80 font-bold cursor-pointer bg-transparent border-0 flex-shrink-0 px-0.5">×</button>
                    </>
                  )}
                </div>
              )}
              {editingRate !== ri && r.description && (
                <p className="text-[10px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed mt-0.5">{r.description}</p>
              )}
              {editingRate !== ri && r.specSame === false && r.specDiff && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 whitespace-pre-wrap leading-relaxed mt-0.5">
                  <span className="font-bold">Their spec: </span>{r.specDiff}
                </p>
              )}
              {editingRate !== ri && (
                <div className="mt-1 space-y-1">
                  {refs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {refs.map((m, mi) => (
                        <div key={mi} className="relative flex-shrink-0">
                          {m.type === "video" ? (
                            <video src={m.url} controls preload="metadata" className="w-20 h-12 rounded-lg object-cover border border-[var(--border-card)] bg-black" />
                          ) : m.type === "pdf" ? (
                            <a href={m.url} download={m.name || `vendor-ref-${mi + 1}.pdf`}
                              className="block px-2 py-1.5 rounded-lg border border-[var(--border-card)] bg-red-500/10 hover:bg-red-500/20 transition-colors text-[10px] font-bold text-[var(--text-primary)] truncate max-w-[8rem]">
                              {m.name || "PDF"}
                            </a>
                          ) : (
                            <img src={m.url} alt={`Vendor reference ${mi + 1}`}
                              className="w-12 h-12 rounded-lg object-cover border border-[var(--border-card)] cursor-zoom-in"
                              onClick={() => onOpenLightbox(m.url, refImages.length > 0 ? refImages : [m.url], Math.max(0, refImages.indexOf(m.url)))} />
                          )}
                          {!readOnly && (
                            <button type="button" onClick={() => removeRateRef(ri, mi)} title="Remove reference"
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] font-bold cursor-pointer border border-white/20">×</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {!readOnly && (
                    <label className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-indigo hover:opacity-80 cursor-pointer">
                      + Reference
                      <input type="file" multiple accept="image/*,video/*,.pdf,application/pdf" className="hidden"
                        onChange={(e) => { void attachRateRefs(ri, e.target.files); e.target.value = ""; }} />
                    </label>
                  )}
                  {refError && <p className="text-[10px] font-semibold text-[var(--color-danger)]">{refError}</p>}
                </div>
              )}
            </li>
            );
          })}
        </ul>
      )}

      {!flagged && !readOnly && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {showAdd ? (
            <div className="flex-1 min-w-[12rem]">
              <ItemRateForm
                submitLabel="Add rate"
                onCancel={() => setShowAdd(false)}
                onAdd={(rate) => { onAddRate(rate); setShowAdd(false); }}
              />
            </div>
          ) : (
            <button type="button" onClick={() => { setShowAdd(true); setShowFlag(false); setEditingRate(null); }}
              className="px-2.5 py-1.5 bg-brand-indigo/10 text-brand-indigo hover:bg-brand-indigo/20 font-bold text-[11px] rounded-lg cursor-pointer border-0">
              + Add vendor rate
            </button>
          )}
          {!locked && !showAdd && (
            showFlag ? (
              <div className="flex-1 min-w-[12rem] space-y-1.5 rounded-lg border border-dashed border-red-500/40 p-2">
                <textarea
                  value={flagReason}
                  onChange={(e) => setFlagReason(e.target.value)}
                  placeholder="What is incorrect in the spec? Be specific for Sales…"
                  rows={2}
                  className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-red-500 text-xs resize-y text-[var(--text-primary)]"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={submitFlag} disabled={!flagReason.trim()}
                    className="px-3 py-1.5 bg-red-500/15 text-red-500 hover:bg-red-500/25 font-bold text-[11px] rounded-lg cursor-pointer border-0 disabled:opacity-40">
                    Flag incorrect spec
                  </button>
                  <button type="button" onClick={() => { setShowFlag(false); setFlagReason(""); }}
                    className="px-3 py-1.5 font-bold text-[11px] rounded-lg cursor-pointer border-0 bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setShowFlag(true)}
                className="px-2.5 py-1.5 bg-transparent border border-red-500/40 text-red-500 hover:bg-red-500/10 font-bold text-[11px] rounded-lg cursor-pointer">
                Incorrect Spec
              </button>
            )
          )}
        </div>
      )}

      {canMarkInternal && !locked && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {item.internalRates ? (
            <button type="button" onClick={onUnmarkInternal}
              title="Return this item to the procurement queue"
              className="px-2.5 py-1.5 bg-transparent border border-violet-500/40 text-violet-500 hover:bg-violet-500/10 font-bold text-[11px] rounded-lg cursor-pointer">
              Return to procurement
            </button>
          ) : (
            <button type="button" onClick={onMarkInternal}
              title="Management sources this item's rates itself — leaves the procurement queue"
              className="px-2.5 py-1.5 bg-violet-500/10 text-violet-500 hover:bg-violet-500/20 font-bold text-[11px] rounded-lg cursor-pointer border-0">
              Handle internally
            </button>
          )}
        </div>
      )}
    </div>
  );
}
