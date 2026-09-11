import React, { useState } from "react";
import { Agent, Enquiry, EnquiryItem, ENQUIRY_SOURCES } from "../mockData";
import ItemBoxList from "./ItemBoxList";

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
  const [formDescription] = useState(() => editingEnquiry?.description || "");
  const [formSource, setFormSource] = useState<string>(() => editingEnquiry?.source || "TL");
  // No enquiry-level attachments — media lives per item only. imageUrls pass
  // through untouched (preserved on edit, empty on create).
  const [formImages] = useState<string[]>(() => editingEnquiry?.imageUrls || []);
  const [formItems, setFormItems] = useState<EnquiryItem[]>(() => (editingEnquiry?.items || []).map((it) => ({ ...it, media: [...(it.media ?? [])] })));

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

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

            <div className="grid grid-cols-2 gap-4">
              {!redacted && (
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
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Received Date</label>
                <div className="px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl text-sm text-[var(--text-tertiary)]">
                  {new Date().toLocaleDateString()}
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Lead By</label>
                <div className="px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl text-sm text-[var(--text-tertiary)]">
                  {editingEnquiry ? (agents.find((a) => String(a.id) === String(editingEnquiry.assignedAgentId))?.name || "Auto-assigned") : "You (auto-detected on save)"}
                </div>
              </div>

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
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Items ({formItems.length})</label>
              <ItemBoxList items={formItems} onChange={setFormItems} />
            </div>

            <div className="space-y-2">
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Attach drawings / photos on each item below — there are no enquiry-level attachments.
              </p>
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
