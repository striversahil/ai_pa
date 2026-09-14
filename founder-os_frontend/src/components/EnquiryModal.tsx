import React, { useState, useRef } from "react";
import { Agent, Enquiry, EnquiryItem, ENQUIRY_SOURCES } from "../mockData";
import ItemBoxList from "./ItemBoxList";
import { filesToMedia, dragHasFiles } from "../lib/imageFiles";

// Enquiry-level image cap mirrors ItemBoxList (10MB per file, data-URI).
const MAX_ENQUIRY_IMAGE_BYTES = 10 * 1024 * 1024;

interface EnquiryModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingEnquiry: Enquiry | null;
  agents: Agent[];
  currentAgent: Agent;
  clients?: Array<{ name: string; openEstimates: number; enquiries: number }>;
  redacted?: boolean;
    onSave: (data: {
    estNumber: string;
    source: string;
    clientCompany: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    priority: "high" | "medium" | "low";
    status: Enquiry["status"];
    assignedAgentId: string;
    description: string;
    imageUrls: string[];
    items: EnquiryItem[];
  }) => void;
  isSaving?: boolean;
  saveError?: string | null;
}

export default function EnquiryModal({
  isOpen,
  onClose,
  editingEnquiry,
  agents,
  currentAgent,
  clients = [],
  redacted = false,
  onSave,
  isSaving = false,
  saveError = null
}: EnquiryModalProps) {
  // Localized form states initialized directly from editingEnquiry (or defaults)
  const [formEst, setFormEst] = useState(() => editingEnquiry?.estNumber || "");
  const [formCompany, setFormCompany] = useState(() => editingEnquiry?.clientCompany || "");
  const [formContactName, setFormContactName] = useState(() => editingEnquiry?.contactName || "");
  const [formContactEmail, setFormContactEmail] = useState(() => editingEnquiry?.contactEmail || "");
  const [formContactPhone, setFormContactPhone] = useState(() => editingEnquiry?.contactPhone || "");
  // Description has no input in the modal (item-driven enquiries) — the value
  // is preserved on edit and empty on create, submitted through untouched.
  const [formDescription, setFormDescription] = useState(() => editingEnquiry?.description || "");
  const [formSource, setFormSource] = useState<string>(() => editingEnquiry?.source || "TL");
  // Unstructured intake (create only): enquiry-level photos for the vision
  // extractor. Media lives per item on edit; imageUrls pass through there.
  const [formImages, setFormImages] = useState<string[]>(() => editingEnquiry?.imageUrls || []);
  const [imageError, setImageError] = useState<string | null>(null);
  const [photoDragOver, setPhotoDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formItems, setFormItems] = useState<EnquiryItem[]>(() => (editingEnquiry?.items || []).map((it) => ({ ...it, media: [...(it.media ?? [])] })));

  if (!isOpen) return null;

  const isCreate = !editingEnquiry;

  const handleImages = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setImageError(null);
    const list = Array.from(files);
    const tooBig = list.find((f) => f.size > MAX_ENQUIRY_IMAGE_BYTES);
    // Downscaled photos land at ~200-500KB — always under the intake vision
    // cap, so dropped images actually reach the AI (not just the gallery).
    const { media, skipped } = await filesToMedia(list.filter((f) => f.size <= MAX_ENQUIRY_IMAGE_BYTES));
    if (tooBig || skipped.length > 0) {
      setImageError(
        [tooBig ? `"${tooBig.name}" exceeds 10MB and was skipped.` : null, skipped.length > 0 ? `Skipped: ${skipped.join(", ")}` : null]
          .filter(Boolean)
          .join(" ")
      );
    }
    const urls = media.filter((m) => m.type === "image").map((m) => m.url);
    if (urls.length > 0) setFormImages((prev) => [...prev, ...urls]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePhotoDrop = (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    setPhotoDragOver(false);
    void handleImages(e.dataTransfer.files);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Unstructured intake: AI splits items + extracts lead fields afterwards.
    // Manual item boxes stay available on modify.
    const items = isCreate
      ? []
      : formItems.filter((it) => it.name.trim() || it.qty.trim() || it.spec.trim() || (it.media ?? []).length > 0);

    onSave({
      estNumber: formEst.trim(),
      source: formSource,
      clientCompany: formCompany,
      contactName: formContactName,
      contactEmail: formContactEmail,
      contactPhone: formContactPhone,
      priority: editingEnquiry?.priority || "medium",
      status: editingEnquiry?.status || "new",
      // Lead auto-detect: the creator's roster row owns the enquiry (resolved
      // server-side by login email); edits preserve the stored lead.
      assignedAgentId: editingEnquiry?.assignedAgentId || "",
      description: formDescription,
      imageUrls: formImages,
      items,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl shadow-xl w-full max-w-[540px] max-h-[90vh] overflow-y-auto animate-fade-in flex flex-col">
        <div className="flex justify-between items-center px-5 py-4 border-b border-[var(--border-card)]">
          <h2 className="font-heading font-extrabold text-base md:text-lg">
            {editingEnquiry ? "Modify B2B Enquiry" : "Log New B2B Enquiry"}
          </h2>
          <button 
            onClick={onClose} 
            className="p-1 rounded-full hover:bg-[var(--bg-input)] transition-all cursor-pointer bg-transparent border-0"
            type="button"
          >
            <svg className="w-5 h-5 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            {isCreate ? (
            <>
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Enquiry — type or paste anything</label>
              <textarea
                placeholder={"e.g. Rajdhani Flour Mill, Haryana — 24GG Milling Fabric 136cm 50 mtr + conveyor belt fastener 1000 nos…\n\nWrite client + items in your own words; AI splits items, extracts details and checks past prices."}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={8}
                className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] text-sm text-[var(--text-primary)] resize-y min-h-[160px]"
              />
            </div>

            <div
              className={`space-y-2 rounded-xl p-2 -m-2 transition-colors ${photoDragOver ? "bg-brand-indigo/10 outline-2 outline-dashed outline-brand-indigo" : ""}`}
              onDragOver={(e) => { if (dragHasFiles(e)) { e.preventDefault(); setPhotoDragOver(true); } }}
              onDragLeave={() => setPhotoDragOver(false)}
              onDrop={handlePhotoDrop}
            >
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Photos — nameplate / drawing / chit ({formImages.length})</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleImages(e.target.files)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center px-3 py-2 border border-dashed border-[var(--border-card)] rounded-xl text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-input)] cursor-pointer bg-transparent"
              >
                + Attach photos
              </button>
              {imageError && <p className="text-[11px] text-red-500 font-semibold">{imageError}</p>}
              {formImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {formImages.map((url, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-[var(--border-card)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`attachment ${i + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        aria-label="Remove photo"
                        onClick={() => setFormImages((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-[11px] leading-none cursor-pointer border-0"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Attach photos or drag &amp; drop them here. AI reads the text + photos, splits items and checks past prices. Missing details will be asked right on the enquiry — nothing goes to procurement incomplete.
              </p>
            </div>
            </>
            ) : null}
            {(!isCreate && !redacted) && (
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Company Name</label>
              <input
                type="text"
                list="enquiry-client-list"
                placeholder="Select client or type a new one…"
                value={formCompany}
                onChange={(e) => setFormCompany(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] text-sm text-[var(--text-primary)]"
              />
              <datalist id="enquiry-client-list">
                {clients.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.openEstimates > 0 ? `${c.openEstimates} open estimate${c.openEstimates === 1 ? "" : "s"}` : c.enquiries > 0 ? `${c.enquiries} enquir${c.enquiries === 1 ? "y" : "ies"}` : ""}
                  </option>
                ))}
              </datalist>
            </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {!isCreate && !redacted && (
              <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">EST No.</label>
                <input 
                  type="text" 
                  placeholder="e.g. EST-2026-0001" 
                  value={formEst} 
                  onChange={(e) => setFormEst(e.target.value)} 
                  className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] text-sm text-[var(--text-primary)]"
                />
              </div>
              )}

              {!isCreate && !redacted && (
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Contact Person</label>
                <input 
                  type="text" 
                  placeholder="e.g. Sanjay Singhal" 
                  value={formContactName} 
                  onChange={(e) => setFormContactName(e.target.value)} 
                  className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] text-sm text-[var(--text-primary)]"
                />
              </div>
              )}
            </div>

            {!isCreate && !redacted && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Contact Email</label>
                <input 
                  type="email" 
                  placeholder="e.g. sanjay.s@rajdhaniflour.in" 
                  value={formContactEmail} 
                  onChange={(e) => setFormContactEmail(e.target.value)} 
                  className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] text-sm text-[var(--text-primary)]"
                />
              </div>
              
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Contact Phone</label>
                <input 
                  type="text" 
                  placeholder="e.g. +91 98110 44521" 
                  value={formContactPhone} 
                  onChange={(e) => setFormContactPhone(e.target.value)} 
                  className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] text-sm text-[var(--text-primary)]"
                />
              </div>
            </div>
            )}

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Source</label>
                <select
                  value={formSource}
                  onChange={(e) => setFormSource(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-sm font-semibold cursor-pointer text-[var(--text-primary)]"
                >
                  {ENQUIRY_SOURCES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

            {!isCreate && (
            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Items ({formItems.length})</label>
              <ItemBoxList items={formItems} onChange={setFormItems} />
            </div>
            )}

            {!isCreate && formSource !== "B2B" && (
              <div className="space-y-2">
                <p className="text-[11px] text-[var(--text-tertiary)]">
                  Attach drawings / photos on each item below — there are no enquiry-level attachments.
                </p>
              </div>
            )}
          </div>

          <div className="px-5 py-4 border-t border-[var(--border-card)] flex justify-end gap-2 bg-[var(--bg-input)]/10">
            {saveError && <span className="text-xs text-red-500 font-semibold mr-auto">{saveError}</span>}
            <button 
              type="button" 
              onClick={onClose} 
              disabled={isSaving}
              className="inline-flex justify-center items-center px-4 py-2 border border-[var(--border-card)] hover:bg-[var(--bg-input)] font-bold text-xs rounded-lg cursor-pointer bg-transparent text-[var(--text-primary)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={isSaving}
              className="inline-flex justify-center items-center gap-2 px-4 py-2 bg-brand-indigo hover:opacity-90 text-white font-bold text-xs rounded-lg cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <span className="inline-block h-3 w-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Processing with AI…
                </>
              ) : (editingEnquiry ? "Save Changes" : "Log Enquiry")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
