import React, { useState } from "react";
import { Enquiry, EnquiryItem, parseMoneyInput } from "../types";
import AdditionalRequirementModal from "./AdditionalRequirementModal";
import ToggleSwitch from "./ToggleSwitch";
import IntakeItemMeta from "./IntakeItemMeta";
import AiProcessingLoader from "./AiProcessingLoader";
import { missingForItem, unmatchedMissing, SHOW_INTAKE_REMARKS, type IntakeSuggestion } from "../hooks/useIntake";
import { cleanQty, duplicateItem } from "./ItemBoxList";
import FlagThread from "./FlagThread";
import { filesToMedia, dragHasFiles } from "../lib/imageFiles";

/** ~10MB per file (stored as data-URI on the item; server re-checks). */
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

interface SpecificationsSectionProps {
  selectedEnquiry: Enquiry;
  onOpenLightbox: (url: string, list?: string[], idx?: number) => void;
  onAddRequirement?: (text: string, images: string[]) => void;
  onUpdateItems?: (items: EnquiryItem[]) => void;
  redacted?: boolean;
  /** Vendor-rate visibility per view: sales sees finals only ('none');
   *  procurement collects rates ('edit'); management reviews them ('view'). */
  ratesMode?: "none" | "edit" | "view";
  /** AI intake (suggestions + missing slots) rendered per item row.
   *  `ready:false` = the GH intake action hasn't finished yet. */
  intake?: { suggestions: IntakeSuggestion[]; missing: string[]; ready?: boolean } | null;
  /** Sales 1-click quote-from-memory (marks rateAvailable on the item). */
  onAcceptSuggestion?: (itemIndex: number) => void;
}

export default function SpecificationsSection({ selectedEnquiry, onOpenLightbox, onAddRequirement, onUpdateItems, redacted = false, ratesMode, intake, onAcceptSuggestion }: SpecificationsSectionProps) {
  const mode: "none" | "edit" | "view" = ratesMode ?? (!!onUpdateItems ? "edit" : "none");
  const [isAddReqOpen, setIsAddReqOpen] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<EnquiryItem>({ name: "", qty: "", spec: "" });
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [remarkIdx, setRemarkIdx] = useState<number | null>(null);
  const [remarkText, setRemarkText] = useState("");
  // Sales negotiation: client-side expected price + note per item.
  const [expOpen, setExpOpen] = useState<number | null>(null);
  const [expRate, setExpRate] = useState("");
  const [expNote, setExpNote] = useState("");
  // Sales merged info/alternate request: text + common attachment (example pic)
  // goes straight to procurement as variationRequest — NO management approval.
  // Procurement fulfilling with a new rate OR new item media clears it; sales may withdraw anytime.
  const [altReqOpen, setAltReqOpen] = useState<number | null>(null);
  const [altReqText, setAltReqText] = useState("");
  const [altReqImages, setAltReqImages] = useState<string[]>([]);
  const altReqFileRef = React.useRef<HTMLInputElement>(null);
  const handleAltReqImages = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const { media } = await import("../lib/imageFiles").then((m) => m.filesToMedia(list));
    const urls = media.filter((m) => m.type === "image").map((m) => m.url);
    if (urls.length > 0) setAltReqImages((prev) => [...prev, ...urls]);
  };
  // Common per-item thread — always open (even after sent), sales↔procurement
  // except negotiation (expectedRate). Text+image back-and-forth per item.
  const [threadComposeIdx, setThreadComposeIdx] = useState<number | null>(null);
  const [threadComposeText, setThreadComposeText] = useState("");
  const [threadComposeImages, setThreadComposeImages] = useState<string[]>([]);
  const threadComposeFileRef = React.useRef<HTMLInputElement>(null);
  const handleThreadComposeImages = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const { media } = await import("../lib/imageFiles").then((m) => m.filesToMedia(list));
    const urls = media.filter((m) => m.type === "image").map((m) => m.url);
    if (urls.length > 0) setThreadComposeImages((prev) => [...prev, ...urls]);
  };

  const items = Array.isArray(selectedEnquiry.items) ? selectedEnquiry.items : [];
  const editable = !!onUpdateItems && !redacted;
  // Vendor-rate collection follows the view mode, not the item-edit flag:
  // procurement ('edit') collects, management ('view') reviews. Sales
  // ('none') never sees vendor quotes — only the decided final rate per
  // item (partiality is shown once at the enquiry level) plus the
  // management remarks in the thread below.
  const ratesEditable = !!onUpdateItems && mode === "edit";
  const [rateDrafts, setRateDrafts] = useState<Record<number, { vendor: string; description: string; rate: string; specMode: "same" | "diff"; specDiff: string }>>({});

  const blankRateDraft = () => ({ vendor: "", description: "", rate: "", specMode: "same" as const, specDiff: "" });

  const patchRateDraft = (idx: number, patch: Partial<{ vendor: string; description: string; rate: string; specMode: "same" | "diff"; specDiff: string }>) =>
    setRateDrafts((prev) => {
      const cur = prev[idx] ?? blankRateDraft();
      return { ...prev, [idx]: { ...cur, ...patch } };
    });

  const addItemRate = (idx: number) => {
    if (!onUpdateItems) return;
    const d = rateDrafts[idx] ?? { vendor: "", description: "", rate: "", specMode: "same" as const, specDiff: "" };
    const vendor = d.vendor.trim();
    const rate = parseMoneyInput(d.rate);
    if (!vendor) {
      setRateError("Enter the vendor name before adding the rate.");
      return;
    }
    if (rate === null) {
      setRateError(`"${d.rate.trim()}" is not a valid amount — use digits only (e.g. 1200 or 1200.50).`);
      return;
    }
    setRateError(null);
    const specSame = d.specMode !== "diff";
    const next = items.map((it, i) => (i === idx ? { ...it, rates: [...(it.rates ?? []), {
      vendor,
      rate,
      description: d.description.trim() || undefined,
      specSame,
      specDiff: !specSame && d.specDiff.trim() ? d.specDiff.trim() : undefined,
      quotedAt: new Date().toISOString(),
    }] } : it));
    onUpdateItems(next);
    setRateDrafts((prev) => ({ ...prev, [idx]: { vendor: "", description: "", rate: "", specMode: "same", specDiff: "" } }));
  };

  const removeItemRate = (idx: number, rateIdx: number) => {
    if (!onUpdateItems) return;
    const next = items.map((it, i) => (i === idx ? { ...it, rates: (it.rates ?? []).filter((_, j) => j !== rateIdx) } : it));
    onUpdateItems(next);
  };

  const openItemMedia = (idx: number, url: string) => {
    const list = (items[idx]?.media ?? []).map((m) => m.url).filter(Boolean);
    onOpenLightbox(url, list.length > 0 ? list : [url], Math.max(0, list.indexOf(url)));
  };

  const addItemMedia = async (idx: number, files: FileList | File[] | null) => {
    if (!files || files.length === 0 || !onUpdateItems) return;
    setMediaError(null);
    const list = Array.from(files);
    const tooBig = list.find((f) => f.size > MAX_MEDIA_BYTES);
    if (tooBig) {
      setMediaError(`"${tooBig.name}" exceeds 10MB and was skipped.`);
    }
    const { media, skipped } = await filesToMedia(list.filter((f) => f.size <= MAX_MEDIA_BYTES));
    if (skipped.length > 0) {
      setMediaError((prev) => [prev, `Skipped: ${skipped.join(", ")}`].filter(Boolean).join(" "));
    }
    if (media.length === 0) return;
    const next = items.map((it, i) => (i === idx ? { ...it, media: [...(it.media ?? []), ...media] } : it));
    onUpdateItems(next);
  };

  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const handleItemDrop = (idx: number, e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    setDropIdx(null);
    void addItemMedia(idx, e.dataTransfer.files);
  };

  const removeItemMedia = (idx: number, mediaIdx: number) => {
    if (!onUpdateItems) return;
    const next = items.map((it, i) => (i === idx ? { ...it, media: (it.media ?? []).filter((_, j) => j !== mediaIdx) } : it));
    onUpdateItems(next);
  };

  const startEdit = (idx: number) => {
    setEditingIdx(idx);
    setDraft({ ...items[idx] });
  };
  const saveEdit = () => {
    if (editingIdx === null || !onUpdateItems) return;
    if (!draft.name.trim() && !draft.qty.trim() && !draft.spec.trim()) return;
    // Manual edit takes ownership — clears the AI-split flag so the intake
    // action never overwrites a hand-corrected item.
    const { aiPending, ...draftRest } = draft as any;
    void aiPending;
    const next = items.map((it, i) => (i === editingIdx ? { ...draftRest, media: it.media ?? [] } : it));
    onUpdateItems(next);
    setEditingIdx(null);
  };
  const sendRemark = (idx: number) => {
    const text = remarkText.trim();
    if (!text || !onUpdateItems) return;
    const entry = { by: "sales" as const, kind: "remark" as const, text: text.slice(0, 2000), at: new Date().toISOString() };
    onUpdateItems(items.map((it, i) => (i === idx ? { ...it, thread: [...(it.thread ?? []), entry] } : it)));
    setRemarkText("");
    setRemarkIdx(null);
  };
  const deleteItem = (idx: number) => {
    if (!onUpdateItems) return;
    onUpdateItems(items.filter((_, i) => i !== idx));
    if (editingIdx === idx) setEditingIdx(null);
  };
  // Sales-owned expected price: target ₹ (+ optional note like "client
  // quoted X elsewhere"). Saved onto the item + trailed as a sales remark
  // so procurement (negotiation target) and management (vs vendor rates)
  // both see it live. Clearing removes the target, also trailed.
  const openExpected = (idx: number) => {
    const it = items[idx];
    setExpOpen(idx);
    setExpRate(it?.expectedRate !== undefined && it?.expectedRate !== null ? String(it.expectedRate) : "");
    setExpNote(it?.expectedNote ?? "");
    setRateError(null);
  };
  const saveExpected = (idx: number) => {
    if (!onUpdateItems) return;
    const raw = expRate.trim();
    const note = expNote.trim();
    let rate: number | undefined;
    if (raw) {
      const v = parseMoneyInput(raw);
      if (v === null) {
        setRateError(`"${raw}" is not a valid amount — use digits only (e.g. 1200 or 1200.50).`);
        return;
      }
      rate = v;
    }
    setRateError(null);
    const text = rate !== undefined
      ? `Expected price set: ₹${rate.toLocaleString("en-IN")}${note ? ` — ${note}` : ""}`
      : "Expected price removed";
    const entry = { by: "sales" as const, kind: "remark" as const, text: text.slice(0, 500), at: new Date().toISOString() };
    onUpdateItems(items.map((it, i) => (i === idx ? {
      ...it,
      expectedRate: rate,
      expectedNote: note || undefined,
      thread: [...(it.thread ?? []), entry],
    } : it)));
    setExpOpen(null);
    setExpRate("");
    setExpNote("");
  };
  const copyItem = (idx: number) => {
    if (!onUpdateItems) return;
    onUpdateItems([...items.slice(0, idx + 1), duplicateItem(items[idx]), ...items.slice(idx + 1)]);
  };
  // Request info/alternate for item idx: saves variationRequest + common attachment.
  const sendAlternateRequest = (idx: number) => {
    const text = altReqText.trim().slice(0, 500);
    if (!text || !onUpdateItems) return;
    const media = altReqImages.map((url) => ({ type: "image" as const, url }));
    onUpdateItems(items.map((it, i) => (i === idx ? { ...it, variationRequest: text, variationRequestMedia: media.length ? media : undefined } : it)));
    setAltReqText("");
    setAltReqImages([]);
    setAltReqOpen(null);
  };
  // Withdraw a pending request (explicit "" clears server-side).
  const withdrawAlternateRequest = (idx: number) => {
    if (!onUpdateItems) return;
    onUpdateItems(items.map((it, i) => (i === idx ? { ...it, variationRequest: "", variationRequestMedia: undefined } : it)));
    setAltReqOpen(null);
    setAltReqText("");
    setAltReqImages([]);
  };
  // Common thread post per item — always open (even after sent), text+image.
  const sendThread = (idx: number) => {
    const text = threadComposeText.trim();
    if ((!text && threadComposeImages.length === 0) || !onUpdateItems) return;
    const media = threadComposeImages.map((url) => ({ type: "image" as const, url }));
    const entry: any = { kind: "remark" as const, text: text.slice(0, 2000) || (media.length ? "Attachment" : ""), at: new Date().toISOString(), media: media.length ? media : undefined };
    onUpdateItems(items.map((it, i) => (i === idx ? { ...it, thread: [...(it.thread ?? []), entry] } : it)));
    setThreadComposeText("");
    setThreadComposeImages([]);
    setThreadComposeIdx(null);
  };
  const resolveThread = (idx: number) => {
    if (!onUpdateItems) return;
    onUpdateItems(items.map((it, i) => (i === idx ? { ...it, threadResolved: true } : it)));
  };
  const reopenThread = (idx: number) => {
    if (!onUpdateItems) return;
    onUpdateItems(items.map((it, i) => (i === idx ? { ...it, threadResolved: false } : it)));
  };

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-5 shadow-sm space-y-4">
      <div className="border-b border-[var(--border-card)] pb-3 flex items-center justify-between gap-2">
        <h3 className="font-heading font-extrabold text-base flex items-center gap-2 text-[var(--text-primary)]">
          <svg className="w-5 h-5 text-brand-indigo" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span>Technical Requirements & Drawings</span>
        </h3>
        {onAddRequirement && (
          <button
            onClick={() => setIsAddReqOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-indigo/10 text-brand-indigo hover:bg-brand-indigo/20 font-bold text-xs rounded-lg transition-all duration-200 cursor-pointer bg-transparent border-0"
            type="button"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Requirement
          </button>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-1.5">
            Items ({items.length})
          </span>
          {intake && SHOW_INTAKE_REMARKS && unmatchedMissing(intake.missing ?? [], items).length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {unmatchedMissing(intake.missing ?? [], items).map((m, i) => (
                <span key={i} className="px-1.5 py-px text-[10px] font-bold rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  {m}
                </span>
              ))}
            </div>
          )}
          {items.length === 0 ? (
            (() => {
              // New-enquiry intake: fresh row + source text/photos + runner not
              // done yet (KV `ready:false`) = AI actively working → loader.
              // Anything older settles back to the plain empty copy.
              const createdMs = new Date(selectedEnquiry.createdAt).getTime();
              const isFresh = Number.isFinite(createdMs) && Date.now() - createdMs < 15 * 60 * 1000;
              const hasSource = !!(
                selectedEnquiry.description?.trim() ||
                (selectedEnquiry.imageUrls ?? []).length > 0 ||
                (selectedEnquiry.additionalRequirements ?? []).length > 0
              );
              const intakePending = !intake || (intake as any).ready === false;
              if (!redacted && isFresh && hasSource && intakePending) {
                return (
                  <AiProcessingLoader
                    title="AI reading your enquiry…"
                    subtitle="Splitting items + checking past prices — they appear here automatically"
                  />
                );
              }
              return (
                <p className="text-xs text-[var(--text-tertiary)] font-medium bg-[var(--bg-input)]/25 p-3 rounded-xl border border-[var(--border-card)]/50">
                  {redacted ? "Preparing secure view…" : "No items yet — add the first one below."}
                </p>
              );
            })()
          ) : (
            <ul className="space-y-2">
              {items.map((it, idx) => (
                <li
                  key={idx}
                  onDragOver={(e) => { if (editable && dragHasFiles(e)) { e.preventDefault(); if (dropIdx !== idx) setDropIdx(idx); } }}
                  onDragLeave={() => { if (dropIdx === idx) setDropIdx(null); }}
                  onDrop={(e) => { if (editable) handleItemDrop(idx, e); }}
                  title={editable ? "Tip: you can also drag & drop photo files onto this item" : undefined}
                  className={`text-xs md:text-sm p-3 rounded-xl border transition-colors ${dropIdx === idx ? "border-brand-indigo bg-brand-indigo/10" : "bg-[var(--bg-input)]/25 border-[var(--border-card)]/50"}`}
                >
                  {editingIdx === idx && editable ? (
                    <div className="space-y-2">
                      <textarea
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        placeholder="Item name"
                        rows={2}
                        className="w-full px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs resize-y text-[var(--text-primary)]"
                      />
                      <input
                        value={draft.qty}
                        onChange={(e) => setDraft({ ...draft, qty: cleanQty(e.target.value) })}
                        placeholder="Quantity (e.g. 3 PCS)"
                        inputMode="decimal"
                        className="w-full px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
                      />
                      <textarea
                        value={draft.spec}
                        onChange={(e) => setDraft({ ...draft, spec: e.target.value })}
                        placeholder="Specification detail"
                        rows={2}
                        className="w-full px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs resize-y text-[var(--text-primary)]"
                      />
                      <ToggleSwitch
                        checked={draft.rateAvailable === true}
                        onChange={(next) => setDraft({ ...draft, rateAvailable: next })}
                        label="Rate available"
                      />
                      <div className="flex gap-2">
                        <button type="button" onClick={saveEdit} className="px-3 py-1 bg-brand-indigo text-white font-bold text-[11px] rounded-lg cursor-pointer">Save</button>
                        <button type="button" onClick={() => setEditingIdx(null)} className="px-3 py-1 border border-[var(--border-card)] font-bold text-[11px] rounded-lg cursor-pointer bg-transparent text-[var(--text-primary)]">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-extrabold text-[var(--text-primary)]">Item {idx + 1}{it.name ? ` — ${it.name}` : ""}</span>
                        {editable && (
                          <span className="flex items-center gap-2 flex-shrink-0">
                            <ToggleSwitch
                              checked={it.rateAvailable === true}
                              onChange={(next) => {
                                if (!onUpdateItems) return;
                                onUpdateItems(items.map((x, i) => (i === idx ? { ...x, rateAvailable: next } : x)));
                              }}
                              label="Rate available"
                              title="Toggle live — the procurement/management queues update instantly"
                            />
                            <button type="button" onClick={() => startEdit(idx)} className="text-[11px] font-bold text-brand-indigo hover:opacity-80 cursor-pointer bg-transparent border-0">Edit</button>
                            <button type="button" onClick={() => copyItem(idx)} className="text-[11px] font-bold text-brand-indigo hover:opacity-80 cursor-pointer bg-transparent border-0">Duplicate</button>
                            <button type="button" onClick={() => deleteItem(idx)} className="text-[11px] font-bold text-[var(--color-danger)] hover:opacity-80 cursor-pointer bg-transparent border-0">Delete</button>
                          </span>
                        )}
                      </div>
                      {it.verbatim && it.verbatim.trim() && it.verbatim.trim().toLowerCase() !== (it.name ?? "").trim().toLowerCase() && (
                        <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">Client wrote: <span className="font-semibold text-[var(--text-secondary)]">{it.verbatim}</span></p>
                      )}
                      {(it.rateAvailable || String((selectedEnquiry as any).rateStatus ?? "") === "sent") ? (
                        it.rateAvailable ? (
                          <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 text-[11px] font-extrabold">
                            Rate available
                          </div>
                        ) : null
                      ) : null}
                      {(it as any).notAvailable && (
                        <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-zinc-800 border border-zinc-600 text-zinc-200 text-[11px] font-extrabold">
                          Not available{(it as any).notAvailableReason ? ` — ${String((it as any).notAvailableReason).slice(0, 80)}` : ""}
                        </div>
                      )}
                      {(it as any).aiPending === true && (
                        <AiProcessingLoader compact />
                      )}
                      {intake && (
                        <IntakeItemMeta
                          itemIndex={idx}
                          suggestions={intake.suggestions ?? []}
                          missing={missingForItem(intake.missing ?? [], it.name ?? "", idx)}
                          onAccept={onAcceptSuggestion}
                        />
                      )}
                      {!redacted && !it.specIssue && (it.thread ?? []).length > 0 && (
                        <FlagThread thread={it.thread ?? []} onOpenLightbox={onOpenLightbox} hideKinds={mode === "none" ? ["quoted"] : []} />
                      )}
                       {it.specIssue && !redacted && !it.rateAvailable && !(it as any).notAvailable && (
                        <div className="mt-1.5 rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-[11px] leading-relaxed">
                          <p className="font-extrabold text-red-500 uppercase tracking-wide text-[10px]">Spec flagged by Procurement — held from Management</p>
                          <p className="mt-0.5 text-[var(--text-secondary)] whitespace-pre-wrap">{it.specIssue}</p>
                          <p className="mt-1 text-[var(--text-tertiary)]">Edit the spec below or attach the client-shared reference to resolve and release this item for rates.</p>
                          <FlagThread thread={it.thread ?? []} onOpenLightbox={onOpenLightbox} hideKinds={mode === "none" ? ["quoted"] : []} />
                          {editable && (
                            remarkIdx === idx ? (
                              <div className="mt-2 space-y-1.5">
                                <textarea
                                  value={remarkText}
                                  onChange={(e) => setRemarkText(e.target.value)}
                                  placeholder="Remark for procurement (keeps the flag until the spec/reference is fixed)…"
                                  rows={2}
                                  className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs resize-y text-[var(--text-primary)]"
                                />
                                <div className="flex gap-2">
                                  <button type="button" onClick={() => sendRemark(idx)} disabled={!remarkText.trim()}
                                    className="px-3 py-1 bg-brand-indigo text-white font-bold text-[11px] rounded-lg cursor-pointer disabled:opacity-50">Send remark</button>
                                  <button type="button" onClick={() => { setRemarkIdx(null); setRemarkText(""); }}
                                    className="px-3 py-1 font-bold text-[11px] rounded-lg cursor-pointer border-0 bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" onClick={() => { setRemarkIdx(idx); setRemarkText(""); }}
                                className="mt-1.5 text-[11px] font-bold text-brand-indigo hover:opacity-80 cursor-pointer bg-transparent border-0">
                                Add remark
                              </button>
                            )
                          )}
                        </div>
                      )}
                      {(it as any).notAvailable && !redacted && (
                        <div className="mt-1.5 rounded-lg border border-zinc-700 bg-zinc-800/40 p-2 text-[11px] leading-relaxed">
                          <p className="font-extrabold text-zinc-300 uppercase tracking-wide text-[10px]">Not available — flagged by procurement/management</p>
                          {(it as any).notAvailableReason && (
                            <p className="mt-0.5 text-[var(--text-secondary)] whitespace-pre-wrap">{String((it as any).notAvailableReason)}</p>
                          )}
                          <p className="mt-1 text-[var(--text-tertiary)]">Sales sees this item as not available.</p>
                          <FlagThread thread={it.thread ?? []} onOpenLightbox={onOpenLightbox} hideKinds={mode === "none" ? ["quoted"] : []} />
                        </div>
                      )}
                      {it.qty && <div className="text-[11px] font-bold text-[var(--text-secondary)]">Qty: {it.qty}</div>}
                      {it.spec && <p className="text-xs md:text-sm text-[var(--text-secondary)] font-medium whitespace-pre-wrap leading-relaxed mt-0.5">{it.spec}</p>}
                       {!it.rateAvailable && !(it as any).notAvailable && String((selectedEnquiry as any).rateStatus ?? "") !== "sent" && it.internalRates && (it.finalRate === undefined || it.finalRate === null) && (
                        <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-violet-500/10 border border-violet-500/30 text-violet-600 dark:text-violet-400 text-[11px] font-extrabold">
                          Handled internally — rate to follow
                        </div>
                      )}
                      {it.expectedRate !== undefined && it.expectedRate !== null && (
                        <div className="mt-1.5 rounded-lg border border-sky-500/20 bg-sky-500/5 px-2.5 py-2">
                          <p className="text-[11px] font-extrabold text-sky-600 dark:text-sky-400">
                            🎯 Client expects: ₹{Number(it.expectedRate).toLocaleString("en-IN")}
                          </p>
                          {it.expectedNote && (
                            <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed mt-0.5">{it.expectedNote}</p>
                          )}
                        </div>
                      )}
                      {editable && mode === "none"
                        && String(selectedEnquiry.rateStatus ?? "") === "sent"
                        && it.finalRate !== undefined && it.finalRate !== null && (
                        expOpen === idx ? (
                          <div className="mt-1.5 space-y-1.5 rounded-lg border border-dashed border-sky-500/40 p-2">
                            <div className="flex items-center gap-1.5">
                              <input
                                value={expRate}
                                onChange={(e) => setExpRate(e.target.value)}
                                placeholder="Client-expected ₹ (e.g. 1100)"
                                inputMode="decimal"
                                className="flex-1 px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-sky-500 text-xs text-[var(--text-primary)]"
                              />
                              {it.expectedRate !== undefined && it.expectedRate !== null && (
                                <button type="button" onClick={() => { setExpRate(""); setExpNote(""); }}
                                  className="px-2 py-1.5 text-[11px] font-bold text-[var(--color-danger)] hover:opacity-80 cursor-pointer bg-transparent border-0 flex-shrink-0">
                                  Clear
                                </button>
                              )}
                            </div>
                            <input
                              value={expNote}
                              onChange={(e) => setExpNote(e.target.value)}
                              placeholder="Note — e.g. client quoted lower elsewhere, budget cap… (optional)"
                              className="w-full px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-sky-500 text-xs text-[var(--text-primary)]"
                            />
                            <div className="flex gap-2">
                              <button type="button" onClick={() => saveExpected(idx)} disabled={!expRate.trim() && (it.expectedRate === undefined || it.expectedRate === null)}
                                className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white font-bold text-[11px] rounded-lg cursor-pointer disabled:opacity-50">
                                {it.expectedRate !== undefined && it.expectedRate !== null ? "Update target" : "Set target"}
                              </button>
                              <button type="button" onClick={() => { setExpOpen(null); setExpRate(""); setExpNote(""); setRateError(null); }}
                                className="px-3 py-1 font-bold text-[11px] rounded-lg cursor-pointer border-0 bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => openExpected(idx)}
                            className="mt-1.5 text-[11px] font-bold text-sky-600 dark:text-sky-400 hover:opacity-80 cursor-pointer bg-transparent border-0">
                            💬 {it.expectedRate !== undefined && it.expectedRate !== null ? "Negotiate — update expected price" : "Negotiate — set client-expected price"}
                          </button>
                        )
                      )}
                                              {(() => {
                        if (it.rateAvailable || (it as any).notAvailable) return null; // rate available / not available overrides — hide stored final/notes (state kept hidden in D1, restored when toggled off)
                        const selIdx = (it as any)?.selectedRateIdx;
                        const selRate = (it.rates ?? []).find((r) => (r as any).selected === true)
                          ?? (typeof selIdx === "number" ? (it.rates ?? [])[selIdx] : undefined)
                          ?? (it.rates ?? []).find((r) => it.selectedVendor && r.vendor === it.selectedVendor);
                        const note = (selRate as any)?.salesNote ? String((selRate as any).salesNote).trim() : "";
                        const hasRate = it.finalRate !== undefined && it.finalRate !== null;
                        const refs = selRate?.references ?? [];
                        const refImages = refs.filter((m) => m.type !== "video" && m.type !== "pdf").map((m) => m.url).filter(Boolean);
                        // Management-shared alternates (same vendor, two makes): every
                        // shared row except the exact quoted one above.
                        const alts = (it.rates ?? []).filter((r) => r !== selRate && (r as any)?.sharedWithSales === true);
                        const hasContent = hasRate || !!note || refs.length > 0;
                        if (!hasContent) return null;
                        return (
                          <div className="mt-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2 space-y-1.5">
                            {hasRate && (
                              <p className="text-[11px] font-extrabold text-emerald-600 dark:text-emerald-400">
                                {it.internalRates ? "Rate available internally" : "Rate Received"}: ₹{Number(it.finalRate).toLocaleString("en-IN")}
                                {/* discount hidden in enquiry-tracker (sales) — management-only */}
                                {mode !== "none" && (it as any).finalDiscountPercent ? ` · ${(it as any).finalDiscountPercent}% off` : ""}
                              </p>
                            )}
                            {note && <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{note}</p>}
                            {refs.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {refs.map((m, mi) => (
                                  m.type === "video" ? (
                                    <video key={mi} src={m.url} controls preload="metadata" className="w-24 h-14 rounded-lg object-cover border border-[var(--border-card)] bg-black" />
                                  ) : m.type === "pdf" ? (
                                    <a key={mi} href={m.url} download={`reference-${mi + 1}.pdf`}
                                       className="px-2 py-1.5 rounded-lg border border-[var(--border-card)] bg-red-500/10 hover:bg-red-500/20 transition-colors text-[10px] font-bold text-[var(--text-primary)] truncate max-w-[10rem]">
                                      Reference PDF
                                    </a>
                                  ) : (
                                    <img key={mi} src={m.url} alt={`Vendor reference ${mi + 1}`}
                                       className="w-14 h-14 rounded-lg object-cover border border-[var(--border-card)] cursor-zoom-in"
                                       onClick={() => onOpenLightbox(m.url, refImages.length > 0 ? refImages : [m.url], Math.max(0, refImages.indexOf(m.url)))} />
                                  )
                                ))}
                              </div>
                            )}
                            {/* Alternates + alternate requests. The request UI stays
                                visible while a request is pending even after the
                                previous quotes are cleared for the fresh round
                                (no finalRate/alts left to gate on). */}
                            {(hasRate || String((it as any)?.variationRequest ?? "").trim()) && (alts.length > 0 || editable) && (
                              <div className="pt-1.5 mt-1 border-t border-emerald-500/10 space-y-1">
                                {alts.length > 0 && (
                                  <>
                                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
                                      Alternate option{alts.length === 1 ? "" : "s"} — quoted rate above stays default
                                    </p>
                                    {alts.map((a, ai) => {
                                      const altFinal = (a as any)?.sharedFinalRate !== undefined && (a as any)?.sharedFinalRate !== null
                                        ? Number((a as any).sharedFinalRate) : Number(a.rate);
                                      return (
                                      <div key={ai} className="space-y-0.5">
                                        <p className="text-[11px] font-bold text-[var(--text-primary)]">
                                          Alternate option {ai + 1} · <span className="font-mono font-extrabold text-emerald-600 dark:text-emerald-400">₹{altFinal.toLocaleString("en-IN")}</span>
                                        </p>
                                        {(a as any)?.salesNote && (
                                          <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{String((a as any).salesNote)}</p>
                                        )}
                                      </div>
                                      );
                                    })}
                                  </>
                                )}
                                {editable && (
                                  (it as any)?.variationRequest ? (
                                    <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-2 space-y-1">
                                      <p className="text-[11px] font-extrabold text-sky-600 dark:text-sky-400">
                                        Info/alternate requested — with procurement
                                      </p>
                                      <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{String((it as any).variationRequest)}</p>
                                      {Array.isArray((it as any)?.variationRequestMedia) && (it as any).variationRequestMedia.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 pt-1">
                                          {(it as any).variationRequestMedia.map((m: any, mi: number) => (
                                            <img key={mi} src={m.url} alt={`Request ${mi+1}`} className="w-14 h-14 rounded-lg object-cover border border-[var(--border-card)] cursor-zoom-in" onClick={() => onOpenLightbox(m.url, (it as any).variationRequestMedia.map((x: any)=>x.url), mi)} />
                                          ))}
                                        </div>
                                      )}
                                      <p className="text-[10px] text-[var(--text-tertiary)]">With procurement — quoted rate or reference media will clear this.</p>
                                      <button type="button" onClick={() => withdrawAlternateRequest(idx)}
                                        className="text-[11px] font-bold text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer bg-transparent border-0">
                                        Withdraw request
                                      </button>
                                    </div>
                                  ) : altReqOpen === idx ? (
                                    <div className="space-y-1.5 rounded-lg border border-dashed border-sky-500/40 p-2">
                                      <textarea
                                        value={altReqText}
                                        onChange={(e) => setAltReqText(e.target.value)}
                                        placeholder="Ask for alternate make or reference — e.g. ABB make, or need reference picture/datasheet…"
                                        rows={2}
                                        className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-sky-500 text-xs resize-y text-[var(--text-primary)]"
                                      />
                                      <input ref={altReqFileRef} type="file" accept="image/*,video/*,.pdf" multiple className="hidden" onChange={(e) => { void handleAltReqImages(e.target.files); e.target.value=""; }} />
                                      <div className="flex flex-wrap items-center gap-2">
                                        <button type="button" onClick={() => altReqFileRef.current?.click()} className="px-2.5 py-1 border border-dashed border-[var(--border-card)] rounded-lg text-[11px] font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-input)] cursor-pointer bg-transparent">+ Attach reference</button>
                                        <span className="text-[10px] text-[var(--text-tertiary)]">Common attachment for sales ↔ procurement</span>
                                      </div>
                                      {altReqImages.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                          {altReqImages.map((url, i) => (
                                            <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border border-[var(--border-card)]">
                                              <img src={url} alt={`req ${i+1}`} className="w-full h-full object-cover" />
                                              <button type="button" onClick={() => setAltReqImages(prev => prev.filter((_, j) => j !== i))} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-[11px] cursor-pointer border-0">×</button>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      <div className="flex gap-2">
                                        <button type="button" onClick={() => sendAlternateRequest(idx)} disabled={!altReqText.trim()}
                                          className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white font-bold text-[11px] rounded-lg cursor-pointer disabled:opacity-50 border-0">
                                          Request info/alternate
                                        </button>
                                        <button type="button" onClick={() => { setAltReqOpen(null); setAltReqText(""); setAltReqImages([]); }}
                                          className="px-3 py-1 font-bold text-[11px] rounded-lg cursor-pointer border-0 bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                                          Cancel
                                        </button>
                                      </div>
                                      <p className="text-[10px] text-[var(--text-tertiary)]">Goes straight to procurement — quoted rate or attached reference will clear this. No management queue.</p>
                                    </div>
                                  ) : (
                                    <button type="button" onClick={() => { setAltReqOpen(idx); setAltReqText(""); setAltReqImages([]); }}
                                      className="text-[11px] font-bold text-sky-600 dark:text-sky-400 hover:opacity-80 cursor-pointer bg-transparent border-0">
                                      💬 Request info / alternate
                                    </button>
                                  )
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {!it.rateAvailable && !(it as any).notAvailable && String((selectedEnquiry as any).rateStatus ?? "") !== "sent" && mode !== "none" && ((it.rates ?? []).length > 0 || ratesEditable) && (
                        <div className="mt-2 space-y-1.5">
                          {(it.rates ?? []).map((r, ri) => (
                            <div key={ri} className="rounded-lg border border-[var(--border-card)]/60 p-2 space-y-1">
                              <div className="flex items-center gap-2 text-[11px]">
                                <span className="font-bold text-[var(--text-primary)] break-words flex-1">{r.vendor}</span>
                                {r.specSame === false && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide bg-amber-500/10 text-amber-500 border border-amber-500/30 flex-shrink-0">Spec differs</span>
                                )}
                                <span className="font-mono text-[var(--text-secondary)] whitespace-nowrap">₹{Number(r.rate).toLocaleString("en-IN")}</span>
                                {ratesEditable && (
                                  <button type="button" onClick={() => removeItemRate(idx, ri)}
                                    className="text-[var(--color-danger)] hover:opacity-80 font-bold cursor-pointer bg-transparent border-0 flex-shrink-0">×</button>
                                )}
                              </div>
                              {r.description && (
                                <p className="text-[10px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{r.description}</p>
                              )}
                              {r.specSame === false && r.specDiff && (
                                <p className="text-[10px] text-amber-600 dark:text-amber-400 whitespace-pre-wrap leading-relaxed">
                                  <span className="font-bold">Their spec: </span>{r.specDiff}
                                </p>
                              )}
                            </div>
                          ))}
                          {ratesEditable && (
                            <div className="space-y-1.5 pt-1 rounded-lg border border-dashed border-[var(--border-card)] p-2">
                              <textarea
                                value={rateDrafts[idx]?.vendor ?? ""}
                                onChange={(e) => patchRateDraft(idx, { vendor: e.target.value })}
                                placeholder="Vendor name & address…"
                                rows={2}
                                className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs resize-y text-[var(--text-primary)]"
                              />
                              <textarea
                                value={rateDrafts[idx]?.description ?? ""}
                                onChange={(e) => patchRateDraft(idx, { description: e.target.value })}
                                placeholder="Vendor description — contact person, terms, delivery…"
                                rows={2}
                                className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs resize-y text-[var(--text-primary)]"
                              />
                              <div className="flex items-center gap-1.5">
                                <input
                                  value={rateDrafts[idx]?.rate ?? ""}
                                  onChange={(e) => patchRateDraft(idx, { rate: e.target.value })}
                                  placeholder="Rate ₹"
                                  inputMode="decimal"
                                  className="flex-1 px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
                                />
                                <div className="flex rounded-lg border border-[var(--border-card)] overflow-hidden text-[11px] font-bold">
                                  <button type="button"
                                    onClick={() => patchRateDraft(idx, { specMode: "same" })}
                                    className={`px-2.5 py-2 cursor-pointer border-0 ${((rateDrafts[idx]?.specMode ?? "same") === "same") ? "bg-brand-indigo text-white" : "bg-transparent text-[var(--text-secondary)]"}`}>
                                    Spec same
                                  </button>
                                  <button type="button"
                                    onClick={() => patchRateDraft(idx, { specMode: "diff" })}
                                    className={`px-2.5 py-2 cursor-pointer border-0 ${((rateDrafts[idx]?.specMode ?? "same") === "diff") ? "bg-amber-500 text-white" : "bg-transparent text-[var(--text-secondary)]"}`}>
                                    Spec different
                                  </button>
                                </div>
                                <button type="button" onClick={() => addItemRate(idx)}
                                  className="px-3 py-2 bg-brand-indigo/10 text-brand-indigo hover:bg-brand-indigo/20 font-bold text-[11px] rounded-lg cursor-pointer border-0 whitespace-nowrap">
                                  Add rate
                                </button>
                              </div>
                              {(rateDrafts[idx]?.specMode ?? "same") === "diff" && (
                                <textarea
                                  value={rateDrafts[idx]?.specDiff ?? ""}
                                  onChange={(e) => patchRateDraft(idx, { specDiff: e.target.value })}
                                  placeholder="Log the vendor's differing spec here…"
                                  rows={2}
                                  className="w-full px-2.5 py-2 bg-amber-500/5 border border-amber-500/30 rounded-lg outline-none focus:border-amber-500 text-xs resize-y text-[var(--text-primary)]"
                                />
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {(it.media ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {(it.media ?? []).map((m, mi) => (
                            m.type === "video" ? (
                              <div key={mi} className="relative flex-shrink-0">
                                <video
                                  src={m.url}
                                  controls
                                  preload="metadata"
                                  className="w-32 h-20 rounded-lg object-cover border border-[var(--border-card)] bg-black"
                                />
                                {editable && (
                                  <button type="button" onClick={() => removeItemMedia(idx, mi)}
                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] font-bold cursor-pointer border border-white/20">×</button>
                                )}
                              </div>
                            ) : m.type === "pdf" ? (
                              <div key={mi} className="relative flex-shrink-0 group">
                                <a
                                  href={m.url}
                                  download={m.name || `item-${idx + 1}-doc-${mi + 1}.pdf`}
                                  title={m.name || "PDF document"}
                                  className="flex items-center gap-1.5 max-w-[12rem] px-2.5 py-2 rounded-lg border border-[var(--border-card)] bg-red-500/10 hover:bg-red-500/20 transition-colors cursor-pointer"
                                >
                                  <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                  </svg>
                                  <span className="text-[10px] font-bold text-[var(--text-primary)] truncate">{m.name || "PDF"}</span>
                                </a>
                                {editable && (
                                  <button type="button" onClick={() => removeItemMedia(idx, mi)}
                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] font-bold cursor-pointer border border-white/20">×</button>
                                )}
                              </div>
                            ) : (
                              <div key={mi} className="relative flex-shrink-0 group">
                                <img
                                  src={m.url}
                                  alt={`Item ${idx + 1} photo ${mi + 1}`}
                                  className="w-16 h-16 rounded-lg object-cover border border-[var(--border-card)] cursor-zoom-in"
                                  onClick={() => openItemMedia(idx, m.url)}
                                />
                                {editable && (
                                  <button type="button" onClick={() => removeItemMedia(idx, mi)}
                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] font-bold cursor-pointer border border-white/20">×</button>
                                )}
                              </div>
                            )
                          ))}
                        </div>
                      )}
                      {!redacted && !(it as any).threadResolved && (
                        <div className="mt-2 pt-2 border-t border-[var(--border-card)]/60">
                          {threadComposeIdx === idx ? (
                            <div className="space-y-1.5">
                              <textarea value={threadComposeText} onChange={(e) => setThreadComposeText(e.target.value)} placeholder="Ask / reply in thread — any question except negotiation, text + image…" rows={2} className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs resize-y text-[var(--text-primary)]" />
                              <input ref={threadComposeFileRef} type="file" multiple accept="image/*,video/*,.pdf,application/pdf" className="hidden" onChange={(e) => { void handleThreadComposeImages(e.target.files); e.target.value=""; }} />
                              <div className="flex flex-wrap items-center gap-2">
                                <button type="button" onClick={() => threadComposeFileRef.current?.click()} className="px-2.5 py-1 border border-dashed border-[var(--border-card)] rounded-lg text-[11px] font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-input)] cursor-pointer bg-transparent">+ Attach</button>
                                {threadComposeImages.length > 0 && <span className="text-[11px] text-[var(--text-tertiary)]">{threadComposeImages.length} attached</span>}
                              </div>
                              {threadComposeImages.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {threadComposeImages.map((url, i) => (
                                    <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border border-[var(--border-card)]">
                                      <img src={url} alt={`thread ${i+1}`} className="w-full h-full object-cover" />
                                      <button type="button" onClick={() => setThreadComposeImages(prev => prev.filter((_, j) => j !== i))} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-[11px] cursor-pointer border-0">×</button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="flex gap-2">
                                <button type="button" onClick={() => sendThread(idx)} disabled={!threadComposeText.trim() && threadComposeImages.length===0} className="px-3 py-1 bg-brand-indigo text-white font-bold text-[11px] rounded-lg cursor-pointer disabled:opacity-50">Send to thread</button>
                                <button type="button" onClick={() => { setThreadComposeIdx(null); setThreadComposeText(""); setThreadComposeImages([]); }} className="px-3 py-1 font-bold text-[11px] rounded-lg cursor-pointer border-0 bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Cancel</button>
                              </div>
                              <p className="text-[10px] text-[var(--text-tertiary)]">Common channel per item — always open, even after sent. Procurement sees it live.</p>
                            </div>
                          ) : (
                            <button type="button" onClick={() => { setThreadComposeIdx(idx); setThreadComposeText(""); setThreadComposeImages([]); }} className="text-[11px] font-bold text-brand-indigo hover:opacity-80 cursor-pointer bg-transparent border-0">💬 Thread — ask / reply (always open)</button>
                          )}
                        </div>
                      )}
                      {(it as any).threadResolved ? (
                        <div className="mt-2 flex items-center gap-2 text-[11px] border border-emerald-500/20 bg-emerald-500/5 rounded-lg px-2.5 py-1.5">
                          <span className="font-bold text-emerald-600">✓ Resolved by {(it as any).threadResolvedBy || "—"}</span>
                          <button onClick={() => reopenThread(idx)} className="ml-auto text-[11px] font-bold text-brand-indigo hover:opacity-80 cursor-pointer bg-transparent border-0">Reopen</button>
                        </div>
                      ) : (
                        !redacted && <button onClick={() => resolveThread(idx)} className="mt-2 text-[11px] font-bold text-[var(--text-tertiary)] hover:text-emerald-600 cursor-pointer bg-transparent border-0">✓ Mark thread as resolved</button>
                      )}
                      {editable && (
                        <label className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold text-brand-indigo hover:opacity-80 cursor-pointer">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          Add attachment
                          <input type="file" multiple accept="image/*,video/*,.pdf,application/pdf" className="hidden"
                            onChange={(e) => { addItemMedia(idx, e.target.files); e.target.value = ""; }} />
                        </label>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {mediaError && (
            <p className="mt-2 text-[11px] font-semibold text-[var(--color-danger)]">{mediaError}</p>
          )}
          {rateError && (
            <p className="mt-2 text-[11px] font-bold text-red-500">{rateError}</p>
          )}
        </div>

        {selectedEnquiry.additionalRequirements && selectedEnquiry.additionalRequirements.length > 0 && (          <div>
            <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-1.5">
              Additional Requirements ({selectedEnquiry.additionalRequirements.length})
            </span>
            <ul className="space-y-2">
              {selectedEnquiry.additionalRequirements.map((req, idx) => (
                <li key={idx} className="flex items-start gap-2.5 text-xs md:text-sm text-[var(--text-secondary)] font-medium bg-[var(--bg-input)]/25 p-2.5 rounded-lg border border-[var(--border-card)]/50">
                  {req.imageUrl && (
                    <img
                      src={req.imageUrl}
                      alt="Requirement attachment"
                      className="w-14 h-14 md:w-16 md:h-16 rounded-lg object-cover border border-[var(--border-card)] cursor-zoom-in flex-shrink-0"
                      onClick={() => onOpenLightbox(req.imageUrl!, selectedEnquiry.additionalRequirements!.map((r) => r.imageUrl!).filter(Boolean), 0)}
                    />
                  )}
                  <span className="pt-1">{req.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {selectedEnquiry.imageUrls && selectedEnquiry.imageUrls.length > 0 && (
          <div>
            <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">Technical Drawings & Photos ({selectedEnquiry.imageUrls.length})</span>
            <div className="flex flex-wrap gap-3">
              {/* Render Image 1 */}
              <div 
                className="relative w-32 h-32 md:w-36 md:h-36 rounded-xl overflow-hidden border border-[var(--border-card)] group cursor-zoom-in bg-zinc-50/5 dark:bg-zinc-900/5 dark:bg-white/5 flex-shrink-0"
                onClick={() => onOpenLightbox(selectedEnquiry.imageUrls![0], selectedEnquiry.imageUrls, 0)}
              >
                <img 
                  src={selectedEnquiry.imageUrls[0]} 
                  alt="Technical drawing 1" 
                  className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200" 
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-all duration-200">
                  <svg className="w-5 h-5 text-zinc-900 dark:text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>

              {/* Render Image 2 */}
              {selectedEnquiry.imageUrls.length > 1 && (
                <div 
                  className="relative w-32 h-32 md:w-36 md:h-36 rounded-xl overflow-hidden border border-[var(--border-card)] group cursor-zoom-in bg-zinc-50/5 dark:bg-zinc-900/5 dark:bg-white/5 flex-shrink-0"
                  onClick={() => onOpenLightbox(selectedEnquiry.imageUrls![1], selectedEnquiry.imageUrls, 1)}
                >
                  <img 
                    src={selectedEnquiry.imageUrls[1]} 
                    alt="Technical drawing 2" 
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200" 
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-all duration-200">
                    <svg className="w-5 h-5 text-zinc-900 dark:text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                </div>
              )}

              {/* Render Image 3 (or more with overlay) */}
              {selectedEnquiry.imageUrls.length > 2 && (
                <div 
                  className="relative w-32 h-32 md:w-36 md:h-36 rounded-xl overflow-hidden border border-[var(--border-card)] group cursor-zoom-in bg-zinc-50/5 dark:bg-zinc-900/5 dark:bg-white/5 flex-shrink-0"
                  onClick={() => onOpenLightbox(selectedEnquiry.imageUrls![2], selectedEnquiry.imageUrls, 2)}
                >
                  <img 
                    src={selectedEnquiry.imageUrls[2]} 
                    alt="Technical drawing 3" 
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200" 
                  />
                  {selectedEnquiry.imageUrls.length > 3 ? (
                    /* Instagram-style overlay showing remaining images count */
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-zinc-900 dark:text-white transition-all duration-200 group-hover:bg-black/50 select-none">
                      <span className="text-xl font-extrabold tracking-tight">+{selectedEnquiry.imageUrls.length - 3}</span>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mt-0.5">drawings</span>
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-all duration-200">
                      <svg className="w-5 h-5 text-zinc-900 dark:text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {onAddRequirement && (
        <AdditionalRequirementModal
          isOpen={isAddReqOpen}
          onClose={() => setIsAddReqOpen(false)}
          onSave={({ text, images }) => {
            onAddRequirement(text, images);
            setIsAddReqOpen(false);
          }}
        />
      )}
    </div>
  );
}
