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
  onNotAvailable?: (reason: string) => void;
  onClearNotAvailable?: () => void;
  onOpenLightbox: (url: string, list?: string[], idx?: number) => void;
  onAddItemMedia?: (media: import("@/types").EnquiryMedia[]) => void;
  onPostThread?: (text: string, media: import("@/types").EnquiryMedia[]) => void;
  onResolveThread?: () => void;
  onReopenThread?: () => void;
  /** History rendering: given rates visible, all mutation UI hidden. */
  readOnly?: boolean;
  /** Late-quote window: the row is finalized (committed) but still accepting
   *  NEW vendor quotes — each addition reopens the decision automatically.
   *  Edit/remove/flag stay locked; only the Add form opens. */
  lateQuote?: boolean;
}

// One compact procurement work card: spec + attachments on top, already-given
// rates as tight rows (editable in place), add-rate and incorrect-spec forms
// collapsed behind buttons so the queue stays scannable. A flagged item shows
// its hold banner (held from Management) but still allows adding/editing
// vendor rates while Sales fixes the spec — they queue until the fix clears.
export default function ProcurementItemCard({
  item, itemIdx, onAddRate, onEditRate, onRemoveRate, onFlag, onNotAvailable, onClearNotAvailable, onOpenLightbox, onAddItemMedia, onPostThread, onResolveThread, onReopenThread,
  readOnly = false,
  lateQuote = false,
}: ProcurementItemCardProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingRate, setEditingRate] = useState<number | null>(null);
  const [showFlag, setShowFlag] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [showNotAvailable, setShowNotAvailable] = useState(false);
  const [notAvailableReason, setNotAvailableReason] = useState("");
  const [refError, setRefError] = useState<string | null>(null);
  const [refDropRi, setRefDropRi] = useState<number | null>(null);
  const [threadOpen, setThreadOpen] = useState(false);
  const [threadText, setThreadText] = useState("");
  const [threadImages, setThreadImages] = useState<string[]>([]);
  const threadFileRef = React.useRef<HTMLInputElement>(null);
  const handleThreadImages = async (files: FileList | File[] | null) => {
    if (!files || files.length===0) return;
    const { media } = await filesToMedia(Array.from(files));
    const urls = media.filter((m) => m.type === "image").map((m) => m.url);
    if (urls.length) setThreadImages((prev) => [...prev, ...urls]);
  };

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

  const submitNotAvailable = () => {
    const reason = notAvailableReason.trim();
    if (!onNotAvailable) return;
    onNotAvailable(reason);
    setNotAvailableReason("");
    setShowNotAvailable(false);
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
        {(item as any).notAvailable && (
          <span className="px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-zinc-800 text-zinc-300 border-zinc-600">
            Not available
          </span>
        )}
        {(item as any).notAvailableRequested && !(item as any).notAvailable && (
          <span className="px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap bg-amber-500/10 text-amber-600 border-amber-500/30">
            Not available requested
          </span>
        )}
      </div>

      {item.spec && (
        <p className="text-xs text-[var(--text-secondary)] font-medium whitespace-pre-wrap leading-relaxed">{item.spec}</p>
      )}

      {item.expectedRate !== undefined && item.expectedRate !== null && (
        <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-2 text-[11px] leading-relaxed">
          <p className="font-extrabold text-sky-600 dark:text-sky-400">
            🎯 Client expects ₹{Number(item.expectedRate).toLocaleString("en-IN")} — negotiate vendors toward this
          </p>
          {item.expectedNote && (
            <p className="mt-0.5 text-[var(--text-secondary)] whitespace-pre-wrap">{item.expectedNote}</p>
          )}
        </div>
      )}

      <FlagThread thread={item.thread ?? []} onOpenLightbox={onOpenLightbox} />
      {(item as any).threadResolved ? (
        <div className="mt-2 flex items-center gap-2 text-[11px] border border-emerald-500/20 bg-emerald-500/5 rounded-lg px-2.5 py-1.5">
          <span className="font-bold text-emerald-600">✓ Resolved by {(item as any).threadResolvedBy || "—"}</span>
          {onReopenThread && <button type="button" onClick={onReopenThread} className="ml-auto text-[11px] font-bold text-brand-indigo hover:opacity-80 cursor-pointer bg-transparent border-0">Reopen</button>}
        </div>
      ) : (
        <>
          {onPostThread && (
            <div className="mt-2">
              {threadOpen ? (
                <div className="space-y-1.5 rounded-lg border border-[var(--border-card)] bg-[var(--bg-input)]/20 p-2">
                  <textarea value={threadText} onChange={(e) => setThreadText(e.target.value)} placeholder="Reply in thread — any question except negotiation, text + image…" rows={2} className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs resize-y" />
                  <input ref={threadFileRef} type="file" multiple accept="image/*,video/*,.pdf,application/pdf" className="hidden" onChange={async (e) => { await handleThreadImages(e.target.files); e.target.value=""; }} />
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => threadFileRef.current?.click()} className="px-2.5 py-1 border border-dashed border-[var(--border-card)] rounded-lg text-[11px] font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-input)] cursor-pointer bg-transparent">+ Attach</button>
                    {threadImages.length>0 && <span className="text-[11px] text-[var(--text-tertiary)]">{threadImages.length} attached</span>}
                  </div>
                  {threadImages.length>0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {threadImages.map((url,i) => (
                        <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border border-[var(--border-card)]">
                          <img src={url} alt={`thread ${i+1}`} className="w-full h-full object-cover" />
                          <button type="button" onClick={() => setThreadImages(prev=>prev.filter((_,j)=>j!==i))} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-[11px] cursor-pointer border-0">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { if (!threadText.trim() && threadImages.length===0) return; const media = threadImages.map(url=>({type:"image" as const,url})); onPostThread(threadText.trim() || "Attachment", media); setThreadText(""); setThreadImages([]); setThreadOpen(false); }} disabled={!threadText.trim() && threadImages.length===0} className="px-3 py-1 bg-brand-indigo text-white font-bold text-[11px] rounded-lg cursor-pointer disabled:opacity-50">Send to thread</button>
                    <button type="button" onClick={() => { setThreadOpen(false); setThreadText(""); setThreadImages([]); }} className="px-3 py-1 font-bold text-[11px] rounded-lg cursor-pointer border-0 bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setThreadOpen(true)} className="text-[11px] font-bold text-brand-indigo hover:opacity-80 cursor-pointer bg-transparent border-0">💬 Thread — ask / reply (always open)</button>
              )}
            </div>
          )}
          {onResolveThread && <button type="button" onClick={onResolveThread} className="mt-2 text-[11px] font-bold text-[var(--text-tertiary)] hover:text-emerald-600 cursor-pointer bg-transparent border-0">✓ Mark thread as resolved</button>}
        </>
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

      {(item as any).notAvailable && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-2.5 text-[11px] leading-relaxed">
          <p className="font-extrabold text-zinc-300 uppercase tracking-wide text-[10px]">Not available — visible to sales (approved by management)</p>
          {(item as any).notAvailableReason && (
            <p className="mt-0.5 text-zinc-400 whitespace-pre-wrap">{String((item as any).notAvailableReason)}</p>
          )}
          <p className="mt-1 text-zinc-500">
            Marked {historyDateChip((item as any).notAvailableAt) || "recently"} · Sales sees this as not available.
          </p>
        </div>
      )}

      {(item as any).notAvailableRequested && !(item as any).notAvailable && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] leading-relaxed">
          <p className="font-extrabold text-amber-600 uppercase tracking-wide text-[10px]">Not available requested — awaiting management approval</p>
          {(item as any).notAvailableRequested && (
            <p className="mt-0.5 text-zinc-600 whitespace-pre-wrap">{String((item as any).notAvailableRequested)}</p>
          )}
          <p className="mt-1 text-zinc-500">
            Requested {historyDateChip((item as any).notAvailableRequestedAt) || "recently"} · Management will review.
          </p>
          {!readOnly && onClearNotAvailable && (
            <button type="button" onClick={() => onClearNotAvailable()} className="mt-2 text-[11px] font-bold text-amber-700 hover:text-amber-800 cursor-pointer bg-transparent border-0">↩ Withdraw request</button>
          )}
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

      {(item as any).variationRequest && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-2.5 text-[11px] leading-relaxed">
          <p className="font-extrabold text-sky-600 dark:text-sky-400 uppercase tracking-wide text-[10px]">Sales requested info / alternate</p>
          <p className="mt-0.5 text-[var(--text-secondary)] whitespace-pre-wrap">{String((item as any).variationRequest)}</p>
          {Array.isArray((item as any).variationRequestMedia) && (item as any).variationRequestMedia.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1.5">
              {(item as any).variationRequestMedia.map((m: any, mi: number) => (
                <img key={mi} src={m.url} alt={`Request ref ${mi+1}`} className="w-12 h-12 rounded-lg object-cover border border-[var(--border-card)] cursor-zoom-in" onClick={() => onOpenLightbox(m.url, (item as any).variationRequestMedia.map((x: any)=>x.url), mi)} />
              ))}
            </div>
          )}
          <p className="mt-1 text-[var(--text-tertiary)]">
            Quote as new vendor rate or attach reference media to item attachments — request clears automatically (no management queue).
          </p>
          {onAddItemMedia && (
            <label className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-sky-500/40 bg-white/50 hover:bg-sky-500/10 cursor-pointer text-[11px] font-bold text-sky-600">
              + Attach reference to item
              <input type="file" multiple accept="image/*,video/*,.pdf,application/pdf" className="hidden" onChange={async (e) => {
                const files = e.target.files;
                if (!files || files.length===0) return;
                const { media } = await filesToMedia(Array.from(files));
                if (media.length) onAddItemMedia(media);
                e.target.value="";
              }} />
            </label>
          )}
        </div>
      )}

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
                  {item.expectedRate !== undefined && item.expectedRate !== null && Number(r.rate) <= Number(item.expectedRate) && (
                    <span className="px-1 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex-shrink-0">✓ within target</span>
                  )}
                  {r.discountPercent !== undefined && r.discountPercent !== null && (
                    <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex-shrink-0">{Number(r.discountPercent).toString()}% off</span>
                  )}
                  {!readOnly && (
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
              {editingRate !== ri && (r as any).salesNote && (
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400 whitespace-pre-wrap leading-relaxed mt-0.5 border-l-2 border-emerald-500/30 pl-2"><span className="font-bold">For sales: </span>{String((r as any).salesNote)}</p>
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

      {(!readOnly || lateQuote) && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {lateQuote && readOnly && (
            <p className="w-full text-[10px] font-semibold text-amber-600 dark:text-amber-400">Finalized row — a new quote reopens the decision for management.</p>
          )}
          {flagged && !readOnly && (
            <p className="w-full text-[10px] font-semibold text-red-400/80">Spec flagged — held from management, but you can still add vendor rates while sales fixes it.</p>
          )}
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
          {!flagged && !locked && !(item as any).notAvailable && !showAdd && !showNotAvailable && (
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
          {!(item as any).notAvailable && !(item as any).notAvailableRequested && !flagged && !locked && !showAdd && !showFlag && onNotAvailable && (
            showNotAvailable ? (
              <div className="flex-1 min-w-[12rem] space-y-1.5 rounded-lg border border-dashed border-zinc-600 p-2">
                <textarea
                  value={notAvailableReason}
                  onChange={(e) => setNotAvailableReason(e.target.value)}
                  placeholder="Reason not available (optional) — visible to sales…"
                  rows={2}
                  className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-zinc-500 text-xs resize-y text-[var(--text-primary)]"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={submitNotAvailable}
                    className="px-3 py-1.5 bg-zinc-700 text-white hover:bg-zinc-600 font-bold text-[11px] rounded-lg cursor-pointer border-0">
                    Mark not available
                  </button>
                  <button type="button" onClick={() => { setShowNotAvailable(false); setNotAvailableReason(""); }}
                    className="px-3 py-1.5 font-bold text-[11px] rounded-lg cursor-pointer border-0 bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setShowNotAvailable(true)}
                className="px-2.5 py-1.5 bg-transparent border border-zinc-600 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 font-bold text-[11px] rounded-lg cursor-pointer">
                Not Available
              </button>
            )
          )}
        </div>
      )}

    </div>
  );
}
