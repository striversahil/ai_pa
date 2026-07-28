import React, { useState } from "react";
import { Agent, Enquiry } from "../mockData";

interface EnquiryModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingEnquiry: Enquiry | null;
  agents: Agent[];
  currentAgent: Agent;
  onSave: (data: {
    clientCompany: string;
    title: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    estimatedValue: string;
    priority: "high" | "medium" | "low";
    status: Enquiry["status"];
    assignedAgentId: string;
    description: string;
    imageUrls: string[];
    createdAt?: string;
  }) => void;
}

export default function EnquiryModal({
  isOpen,
  onClose,
  editingEnquiry,
  agents,
  currentAgent,
  onSave
}: EnquiryModalProps) {
  // Localized form states initialized directly from editingEnquiry (or defaults)
  const [formCompany, setFormCompany] = useState(() => editingEnquiry?.clientCompany || "");
  const [formContactName, setFormContactName] = useState(() => editingEnquiry?.contactName || "");
  const [formContactEmail, setFormContactEmail] = useState(() => editingEnquiry?.contactEmail || "");
  const [formContactPhone, setFormContactPhone] = useState(() => editingEnquiry?.contactPhone || "");
  const [formTitle, setFormTitle] = useState(() => editingEnquiry?.title || "");
  const [formDescription, setFormDescription] = useState(() => editingEnquiry?.description || "");
  const [formPriority, setFormPriority] = useState<"high" | "medium" | "low">(() => editingEnquiry?.priority || "medium");
  const [formStatus, setFormStatus] = useState<Enquiry["status"]>(() => editingEnquiry?.status || "new");
  const [formAgent, setFormAgent] = useState(() => editingEnquiry?.assignedAgentId.toString() || currentAgent.id.toString());
  const [formValue, setFormValue] = useState(() => editingEnquiry?.estimatedValue.toString() || "");
  const [formImages, setFormImages] = useState<string[]>(() => editingEnquiry?.imageUrls || []);
  const [formCreatedAt, setFormCreatedAt] = useState(() => {
    if (editingEnquiry?.createdAt) {
      return new Date(editingEnquiry.createdAt).toISOString().split("T")[0];
    }
    return new Date().toISOString().split("T")[0];
  });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const getSaveDateString = () => {
      const datePart = formCreatedAt || new Date().toISOString().split("T")[0];
      if (editingEnquiry?.createdAt) {
        const origDate = new Date(editingEnquiry.createdAt);
        if (!isNaN(origDate.getTime())) {
          const [year, month, day] = datePart.split("-").map(Number);
          origDate.setFullYear(year, month - 1, day);
          return origDate.toISOString();
        }
      }
      const now = new Date();
      const [year, month, day] = datePart.split("-").map(Number);
      now.setFullYear(year, month - 1, day);
      return now.toISOString();
    };

    onSave({
      clientCompany: formCompany,
      title: formTitle,
      contactName: formContactName,
      contactEmail: formContactEmail,
      contactPhone: formContactPhone,
      estimatedValue: formValue,
      priority: formPriority,
      status: formStatus,
      assignedAgentId: formAgent,
      description: formDescription,
      imageUrls: formImages,
      createdAt: getSaveDateString()
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
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Company Name *</label>
              <input 
                type="text" 
                placeholder="e.g. Rajdhani Roller Flour Mills" 
                value={formCompany} 
                onChange={(e) => setFormCompany(e.target.value)} 
                className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] text-sm text-[var(--text-primary)]"
                required 
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Enquiry Title *</label>
              <input 
                type="text" 
                placeholder="e.g. Sieve Sifter Accessories procurement" 
                value={formTitle} 
                onChange={(e) => setFormTitle(e.target.value)} 
                className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] text-sm text-[var(--text-primary)]"
                required 
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Contact Person *</label>
                <input 
                  type="text" 
                  placeholder="e.g. Sanjay Singhal" 
                  value={formContactName} 
                  onChange={(e) => setFormContactName(e.target.value)} 
                  className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] text-sm text-[var(--text-primary)]"
                  required 
                />
              </div>
              
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Estimated Value (INR) *</label>
                <input 
                  type="number" 
                  placeholder="e.g. 185000" 
                  value={formValue} 
                  onChange={(e) => setFormValue(e.target.value)} 
                  className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] text-sm text-[var(--text-primary)]"
                  required 
                />
              </div>
            </div>

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
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Assign Agent</label>
                <select 
                  value={formAgent} 
                  onChange={(e) => setFormAgent(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-sm font-semibold cursor-pointer text-[var(--text-primary)]"
                >
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Received Date *</label>
                <input 
                  type="date"
                  value={formCreatedAt}
                  onChange={(e) => setFormCreatedAt(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] text-sm text-[var(--text-primary)]"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Description & Detail Requirements</label>
              <textarea 
                rows={3} 
                placeholder="Provide specs, plansifter cleaning configurations, and bag close models..."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] text-sm resize-y text-[var(--text-primary)]"
              />
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
            <button 
              type="button" 
              onClick={onClose} 
              className="inline-flex justify-center items-center px-4 py-2 border border-[var(--border-card)] hover:bg-[var(--bg-input)] font-bold text-xs rounded-lg cursor-pointer bg-transparent text-[var(--text-primary)]"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="inline-flex justify-center items-center px-4 py-2 bg-brand-indigo hover:opacity-90 text-white font-bold text-xs rounded-lg cursor-pointer"
            >
              {editingEnquiry ? "Save Changes" : "Log Enquiry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
