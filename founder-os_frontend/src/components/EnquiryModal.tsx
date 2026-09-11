import React, { useState } from "react";
import { Agent, Enquiry, EnquiryItem, EnquiryMedia } from "../mockData";

/** ~10MB per item file (stored as data-URI on the item; server re-checks). */
const MAX_ITEM_FILE_BYTES = 10 * 1024 * 1024;

const itemMediaKind = (f: File): EnquiryMedia["type"] =>
  f.type.startsWith("video/") ? "video" : (f.type === "application/pdf" || /\.pdf$/i.test(f.name) ? "pdf" : "image");

const blankItem = (): EnquiryItem => ({ name: "", qty: "", spec: "", media: [] });

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
    clientCompany: string;
    title: string;
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
  const [formTitle, setFormTitle] = useState(() => editingEnquiry?.title || "");
  // Description has no input in the modal (item-driven enquiries) — the value
  // is preserved on edit and empty on create, submitted through untouched.
  const [formDescription] = useState(() => editingEnquiry?.description || "");
  const [formPriority, setFormPriority] = useState<"high" | "medium" | "low">(() => editingEnquiry?.priority || "medium");
  const [formStatus, setFormStatus] = useState<Enquiry["status"]>(() => editingEnquiry?.status || "new");
  const [formAgent, setFormAgent] = useState(() => editingEnquiry?.assignedAgentId || currentAgent.id || (agents[0]?.id || ""));
  const [formImages, setFormImages] = useState<string[]>(() => editingEnquiry?.imageUrls || []);
  const [formItems, setFormItems] = useState<EnquiryItem[]>(() => (editingEnquiry?.items || []).map((it) => ({ ...it, media: [...(it.media ?? [])] })));
  const [itemFileError, setItemFileError] = useState<string | null>(null);

  if (!isOpen) return null;

  const updateItem = (idx: number, patch: Partial<EnquiryItem>) =>
    setFormItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const removeItem = (idx: number) =>
    setFormItems((prev) => prev.filter((_, i) => i !== idx));

  const addItemFiles = (idx: number, files: FileList | null) => {
    if (!files || files.length === 0) return;
    setItemFileError(null);
    const accepted = Array.from(files).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/") || f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    const tooBig = Array.from(files).find((f) => f.size > MAX_ITEM_FILE_BYTES);
    if (tooBig) setItemFileError(`"${tooBig.name}" exceeds 10MB and was skipped.`);
    const todo = accepted.filter((f) => f.size <= MAX_ITEM_FILE_BYTES);
    if (todo.length === 0) return;
    const loaded: EnquiryMedia[] = [];
    let processed = 0;
    todo.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) loaded.push({ type: itemMediaKind(file), url: evt.target.result as string, name: file.name });
        processed++;
        if (processed === todo.length) {
          setFormItems((prev) => prev.map((it, i) => (i === idx ? { ...it, media: [...(it.media ?? []), ...loaded] } : it)));
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeItemFile = (idx: number, mediaIdx: number) =>
    setFormItems((prev) => prev.map((it, i) => (i === idx ? { ...it, media: (it.media ?? []).filter((_, j) => j !== mediaIdx) } : it)));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    onSave({
      estNumber: formEst,
      clientCompany: formCompany,
      title: formTitle,
      contactName: formContactName,
      contactEmail: formContactEmail,
      contactPhone: formContactPhone,
      priority: formPriority,
      status: formStatus,
      assignedAgentId: formAgent,
      description: formDescription,
      imageUrls: formImages,
      items: formItems.filter((it) => it.name.trim() || it.qty.trim() || it.spec.trim() || (it.media ?? []).length > 0),
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
            {!redacted && (
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

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Enquiry Title</label>
              <input 
                type="text" 
                placeholder="e.g. Sieve Sifter Accessories procurement" 
                value={formTitle} 
                onChange={(e) => setFormTitle(e.target.value)} 
                className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] text-sm text-[var(--text-primary)]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {!redacted && (
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">EST No. *</label>
                <input 
                  type="text" 
                  placeholder="e.g. EST-2026-0001" 
                  value={formEst} 
                  onChange={(e) => setFormEst(e.target.value)} 
                  className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] text-sm text-[var(--text-primary)]"
                  required 
                />
              </div>
              )}

              {!redacted && (
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

            {!redacted && (
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Priority</label>
                <select 
                  value={formPriority} 
                  onChange={(e) => setFormPriority(e.target.value as "high" | "medium" | "low")}
                  className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-sm font-semibold cursor-pointer text-[var(--text-primary)]"
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>

              {!redacted && (
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Initial Stage</label>
                <select 
                  value={formStatus} 
                  onChange={(e) => setFormStatus(e.target.value as Enquiry["status"])}
                  className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-sm font-semibold cursor-pointer text-[var(--text-primary)]"
                >
                  <option value="new">New</option>
                  <option value="contacted">Contacted</option>
                  <option value="qualified">Qualified</option>
                  <option value="proposal">Proposal</option>
                  <option value="negotiation">Negotiation</option>
                  <option value="won">Closed Won</option>
                  <option value="lost">Closed Lost</option>
                </select>
              </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {!redacted && (
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Lead By</label>
                <select 
                  value={formAgent} 
                  onChange={(e) => setFormAgent(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-sm font-semibold cursor-pointer text-[var(--text-primary)]"
                >
                  {agents.length === 0 && <option value="">No sales staff found</option>}
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              )}

              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Received Date</label>
                <div className="px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl text-sm text-[var(--text-tertiary)]">
                  {new Date().toLocaleDateString()}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Items ({formItems.length})</label>
              {formItems.map((it, idx) => (
                <div key={idx} className="p-3 rounded-xl border border-[var(--border-card)]/60 bg-[var(--bg-input)]/25 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-extrabold text-[var(--text-primary)]">Item {idx + 1}</span>
                    <button type="button" onClick={() => removeItem(idx)}
                      className="text-[11px] font-bold text-[var(--color-danger)] hover:opacity-80 cursor-pointer bg-transparent border-0">
                      Remove
                    </button>
                  </div>
                  <input
                    value={it.name}
                    onChange={(e) => updateItem(idx, { name: e.target.value })}
                    placeholder="Item name (e.g. Conveyor Belt Fastener)"
                    className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={it.qty}
                      onChange={(e) => updateItem(idx, { qty: e.target.value })}
                      placeholder="Qty (e.g. 1000)"
                      className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
                    />
                    <input
                      value={it.spec}
                      onChange={(e) => updateItem(idx, { spec: e.target.value })}
                      placeholder="Spec (e.g. 24GG 1 mtr)"
                      className="w-full px-2.5 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]"
                    />
                  </div>
                  {(it.media ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {(it.media ?? []).map((m, mi) => (
                        <div key={mi} className="relative flex-shrink-0 group">
                          {m.type === "video" ? (
                            <video src={m.url} controls preload="metadata" className="w-24 h-16 rounded-lg object-cover border border-[var(--border-card)] bg-black" />
                          ) : m.type === "pdf" ? (
                            <a href={m.url} download={m.name || `item-${idx + 1}.pdf`} title={m.name || "PDF"}
                              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-[var(--border-card)] bg-red-500/10 text-[10px] font-bold text-[var(--text-primary)] max-w-[10rem]">
                              <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                              </svg>
                              <span className="truncate">{m.name || "PDF"}</span>
                            </a>
                          ) : (
                            <img src={m.url} alt={`Item ${idx + 1} file ${mi + 1}`} className="w-14 h-14 rounded-lg object-cover border border-[var(--border-card)]" />
                          )}
                          <button type="button" onClick={() => removeItemFile(idx, mi)}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] font-bold cursor-pointer border border-white/20">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-brand-indigo hover:opacity-80 cursor-pointer">
                    + Photo / video / PDF
                    <input type="file" multiple accept="image/*,video/*,.pdf,application/pdf" className="hidden"
                      onChange={(e) => { addItemFiles(idx, e.target.files); e.target.value = ""; }} />
                  </label>
                </div>
              ))}
              <button type="button" onClick={() => setFormItems((prev) => [...prev, blankItem()])}
                className="mx-auto flex items-center justify-center gap-2 w-full max-w-xs px-6 py-3.5 bg-brand-indigo hover:opacity-90 text-white font-extrabold text-sm rounded-xl shadow-lg shadow-indigo-600/20 transition-all cursor-pointer border-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add Item
              </button>
              {itemFileError && <p className="text-[11px] font-semibold text-[var(--color-danger)]">{itemFileError}</p>}
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Reference Drawings / Photos (Multi-Upload)</label>
              <input 
                type="file" 
                multiple
                accept="image/*" 
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    const fileList = Array.from(files);
                    const loadedImages: string[] = [];
                    let processed = 0;
                    fileList.forEach(file => {
                      const reader = new FileReader();
                      reader.onload = (evt) => {
                        if (evt.target?.result) {
                          loadedImages.push(evt.target.result as string);
                        }
                        processed++;
                        if (processed === fileList.length) {
                          setFormImages(prev => [...prev, ...loadedImages]);
                        }
                      };
                      reader.readAsDataURL(file);
                    });
                  }
                }}
                className="w-full text-xs text-[var(--text-secondary)] file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-brand-indigo/10 file:text-brand-indigo file:cursor-pointer hover:file:opacity-90"
              />
              {formImages.length > 0 && (
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {formImages.map((img, idx) => (
                    <div key={idx} className="relative aspect-square border border-[var(--border-card)] rounded-xl overflow-hidden group">
                      <img src={img} alt={`Preview ${idx + 1}`} className="w-full h-full object-cover" />
                      <button 
                        type="button" 
                        onClick={() => setFormImages(prev => prev.filter((_, i) => i !== idx))}
                        className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[10px] font-bold transition-all duration-150 rounded-xl cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
