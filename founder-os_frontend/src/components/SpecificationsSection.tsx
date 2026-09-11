import React, { useState } from "react";
import { Enquiry, EnquiryItem, EnquiryMedia } from "../mockData";
import AdditionalRequirementModal from "./AdditionalRequirementModal";

/** ~10MB per file (stored as data-URI on the item; server re-checks). */
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

const mediaKind = (f: File): EnquiryMedia["type"] =>
  f.type.startsWith("video/") ? "video" : (f.type === "application/pdf" || /\.pdf$/i.test(f.name) ? "pdf" : "image");

interface SpecificationsSectionProps {
  selectedEnquiry: Enquiry;
  onOpenLightbox: (url: string, list?: string[], idx?: number) => void;
  onAddRequirement?: (text: string, images: string[]) => void;
  onUpdateItems?: (items: EnquiryItem[]) => void;
  redacted?: boolean;
  /** Vendor-rate visibility per view: sales sees finals only ('none');
   *  procurement collects rates ('edit'); management reviews them ('view'). */
  ratesMode?: "none" | "edit" | "view";
}

export default function SpecificationsSection({ selectedEnquiry, onOpenLightbox, onAddRequirement, onUpdateItems, redacted = false, ratesMode }: SpecificationsSectionProps) {
  const mode: "none" | "edit" | "view" = ratesMode ?? (!!onUpdateItems ? "edit" : "none");
  const [isAddReqOpen, setIsAddReqOpen] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<EnquiryItem>({ name: "", qty: "", spec: "" });
  const [isAdding, setIsAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<EnquiryItem>({ name: "", qty: "", spec: "" });
  const [mediaError, setMediaError] = useState<string | null>(null);

  const items = Array.isArray(selectedEnquiry.items) ? selectedEnquiry.items : [];
  const editable = !!onUpdateItems && !redacted;
  // Vendor-rate collection follows the view mode, not the item-edit flag:
  // procurement ('edit') collects, management ('view') reviews, sales ('none')
  // sees finals only.
  const ratesEditable = !!onUpdateItems && mode === "edit";
  const showVendorRates = mode !== "none";
  const [rateDrafts, setRateDrafts] = useState<Record<number, { vendor: string; rate: string }>>({});

  const addItemRate = (idx: number) => {
    if (!onUpdateItems) return;
    const d = rateDrafts[idx] ?? { vendor: "", rate: "" };
    const vendor = d.vendor.trim();
    const rate = Number(d.rate);
    if (!vendor || !Number.isFinite(rate) || rate < 0) return;
    const next = items.map((it, i) => (i === idx ? { ...it, rates: [...(it.rates ?? []), { vendor, rate }] } : it));
    onUpdateItems(next);
    setRateDrafts((prev) => ({ ...prev, [idx]: { vendor: "", rate: "" } }));
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

  const addItemMedia = (idx: number, files: FileList | null) => {
    if (!files || files.length === 0 || !onUpdateItems) return;
    setMediaError(null);
    const accepted = Array.from(files).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/") || f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    const tooBig = Array.from(files).find((f) => f.size > MAX_MEDIA_BYTES);
    if (tooBig) {
      setMediaError(`"${tooBig.name}" exceeds 10MB and was skipped.`);
    }
    const todo = accepted.filter((f) => f.size <= MAX_MEDIA_BYTES);
    if (todo.length === 0) return;
    const loaded: EnquiryMedia[] = [];
    let processed = 0;
    todo.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          loaded.push({ type: mediaKind(file), url: evt.target.result as string, name: file.name });
        }
        processed++;
        if (processed === todo.length) {
          const next = items.map((it, i) => (i === idx ? { ...it, media: [...(it.media ?? []), ...loaded] } : it));
          onUpdateItems(next);
        }
      };
      reader.readAsDataURL(file);
    });
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
    const next = items.map((it, i) => (i === editingIdx ? { ...draft, media: it.media ?? [] } : it));
    onUpdateItems(next);
    setEditingIdx(null);
  };
  const deleteItem = (idx: number) => {
    if (!onUpdateItems) return;
    onUpdateItems(items.filter((_, i) => i !== idx));
    if (editingIdx === idx) setEditingIdx(null);
  };
  const saveAdd = () => {
    if (!onUpdateItems) return;
    if (!addDraft.name.trim() && !addDraft.qty.trim() && !addDraft.spec.trim()) return;
    onUpdateItems([...items, { ...addDraft }]);
    setAddDraft({ name: "", qty: "", spec: "" });
    setIsAdding(false);
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
          {items.length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)] font-medium bg-[var(--bg-input)]/25 p-3 rounded-xl border border-[var(--border-card)]/50">
              {redacted ? "Preparing secure view…" : "No items yet — add the first one below."}
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((it, idx) => (
                <li key={idx} className="text-xs md:text-sm bg-[var(--bg-input)]/25 p-3 rounded-xl border border-[var(--border-card)]/50">
                  {editingIdx === idx && editable ? (
                    <div className="space-y-2">
                      <input
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        placeholder="Item name"
                        className="w-full px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
                      />
                      <input
                        value={draft.qty}
                        onChange={(e) => setDraft({ ...draft, qty: e.target.value })}
                        placeholder="Quantity"
                        className="w-full px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
                      />
                      <textarea
                        value={draft.spec}
                        onChange={(e) => setDraft({ ...draft, spec: e.target.value })}
                        placeholder="Specification detail"
                        rows={2}
                        className="w-full px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs resize-y text-[var(--text-primary)]"
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
                          <span className="flex gap-1.5 flex-shrink-0">
                            <button type="button" onClick={() => startEdit(idx)} className="text-[11px] font-bold text-brand-indigo hover:opacity-80 cursor-pointer bg-transparent border-0">Edit</button>
                            <button type="button" onClick={() => deleteItem(idx)} className="text-[11px] font-bold text-[var(--color-danger)] hover:opacity-80 cursor-pointer bg-transparent border-0">Delete</button>
                          </span>
                        )}
                      </div>
                      {it.qty && <div className="text-[11px] font-bold text-[var(--text-secondary)]">Qty: {it.qty}</div>}
                      {it.spec && <p className="text-xs md:text-sm text-[var(--text-secondary)] font-medium whitespace-pre-wrap leading-relaxed mt-0.5">{it.spec}</p>}
                      {it.finalRate !== undefined && it.finalRate !== null && (
                        <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[11px] font-extrabold">
                          Rate Received: ₹{Number(it.finalRate).toLocaleString("en-IN")}
                        </div>
                      )}
                      {((it.rates ?? []).length > 0 || ratesEditable) && showVendorRates && (
                        <div className="mt-2 space-y-1.5">
                          {(it.rates ?? []).map((r, ri) => (
                            <div key={ri} className="flex items-center gap-2 text-[11px]">
                              <span className="font-bold text-[var(--text-primary)] break-words flex-1">{r.vendor}</span>
                              <span className="font-mono text-[var(--text-secondary)] whitespace-nowrap">₹{Number(r.rate).toLocaleString("en-IN")}</span>
                              {ratesEditable && (
                                <button type="button" onClick={() => removeItemRate(idx, ri)}
                                  className="text-[var(--color-danger)] hover:opacity-80 font-bold cursor-pointer bg-transparent border-0 flex-shrink-0">×</button>
                              )}
                            </div>
                          ))}
                          {ratesEditable && (
                            <div className="space-y-1.5 pt-1">
                              <textarea
                                value={rateDrafts[idx]?.vendor ?? ""}
                                onChange={(e) => setRateDrafts((prev) => ({ ...prev, [idx]: { vendor: e.target.value, rate: prev[idx]?.rate ?? "" } }))}
                                placeholder="Vendor name & address / dimensions…"
                                rows={2}
                                className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs resize-y text-[var(--text-primary)]"
                              />
                              <div className="flex items-center gap-1.5">
                                <input
                                  value={rateDrafts[idx]?.rate ?? ""}
                                  onChange={(e) => setRateDrafts((prev) => ({ ...prev, [idx]: { vendor: prev[idx]?.vendor ?? "", rate: e.target.value } }))}
                                  placeholder="Rate ₹"
                                  inputMode="decimal"
                                  className="flex-1 px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
                                />
                                <button type="button" onClick={() => addItemRate(idx)}
                                  className="px-3 py-2 bg-brand-indigo/10 text-brand-indigo hover:bg-brand-indigo/20 font-bold text-[11px] rounded-lg cursor-pointer border-0 whitespace-nowrap">
                                  Add rate
                                </button>
                              </div>
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
                      {editable && (
                        <label className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold text-brand-indigo hover:opacity-80 cursor-pointer">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          Add photo / video / PDF
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
          {editable && !isAdding && (
            <button type="button" onClick={() => setIsAdding(true)}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-indigo/10 text-brand-indigo hover:bg-brand-indigo/20 font-bold text-xs rounded-lg transition-all cursor-pointer border-0">
              + Add Item
            </button>
          )}
          {mediaError && (
            <p className="mt-2 text-[11px] font-semibold text-[var(--color-danger)]">{mediaError}</p>
          )}
          {editable && isAdding && (
            <div className="space-y-2 mt-2 p-3 rounded-xl border border-[var(--border-card)]/50 bg-[var(--bg-input)]/25">
              <input
                value={addDraft.name}
                onChange={(e) => setAddDraft({ ...addDraft, name: e.target.value })}
                placeholder="Item name"
                className="w-full px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
              />
              <input
                value={addDraft.qty}
                onChange={(e) => setAddDraft({ ...addDraft, qty: e.target.value })}
                placeholder="Quantity"
                className="w-full px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
              />
              <textarea
                value={addDraft.spec}
                onChange={(e) => setAddDraft({ ...addDraft, spec: e.target.value })}
                placeholder="Specification detail"
                rows={2}
                className="w-full px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs resize-y text-[var(--text-primary)]"
              />
              <div className="flex gap-2">
                <button type="button" onClick={saveAdd} className="px-3 py-1 bg-brand-indigo text-white font-bold text-[11px] rounded-lg cursor-pointer">Add</button>
                <button type="button" onClick={() => { setIsAdding(false); setAddDraft({ name: "", qty: "", spec: "" }); }} className="px-3 py-1 border border-[var(--border-card)] font-bold text-[11px] rounded-lg cursor-pointer bg-transparent text-[var(--text-primary)]">Cancel</button>
              </div>
            </div>
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
