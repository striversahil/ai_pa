import React, { useState } from "react";
import { Agent, Enquiry } from "../mockData";

interface ClientProfileProps {
  selectedEnquiry: Enquiry;
  agents: Agent[];
  onUpdateStatus: (id: string, newStatus: Enquiry["status"]) => void;
  onUpdateAgent: (id: string, newAgentId: string) => void;
}

export default function ClientProfile({
  selectedEnquiry,
  agents,
  onUpdateStatus,
  onUpdateAgent
}: ClientProfileProps) {
  const [unmasked, setUnmasked] = useState(false);

  const maskEmail = (email: string) => {
    if (!email) return "";
    const parts = email.split("@");
    if (parts.length < 2) return email;
    const [name, domain] = parts;
    if (name.length <= 2) return `${name[0]}***@${domain}`;
    return `${name.slice(0, 2)}***@${domain}`;
  };

  const maskPhone = (phone: string) => {
    if (!phone) return "";
    if (phone.length <= 6) return "***-***";
    return `${phone.slice(0, 4)} ***-*** ${phone.slice(-3)}`;
  };

  return (
    <div className="space-y-6">
      {/* B2B Status card */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-5 shadow-sm space-y-4">
        <h3 className="font-heading font-extrabold text-base border-b border-[var(--border-card)] pb-3 text-[var(--text-primary)]">Enquiry Overview</h3>
        
        <div className="space-y-3.5">
          <div>
            <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Client Company</span>
            <span className="font-bold text-base mt-0.5 block text-[var(--text-primary)]">{selectedEnquiry.clientCompany}</span>
          </div>

          <div>
            <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Pipeline Value</span>
            <span className="font-heading font-extrabold text-xl text-brand-indigo block mt-0.5">₹{selectedEnquiry.estimatedValue.toLocaleString()}</span>
          </div>

          <div>
            <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-1">Sales Stage</span>
            <select 
              value={selectedEnquiry.status}
              onChange={(e) => onUpdateStatus(selectedEnquiry.id, e.target.value as Enquiry["status"])}
              className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-sm font-semibold cursor-pointer text-[var(--text-primary)]"
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

          <div>
            <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-1">Assigned Agent</span>
            <select 
              value={selectedEnquiry.assignedAgentId}
              onChange={(e) => onUpdateAgent(selectedEnquiry.id, e.target.value)}
              className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-sm font-semibold cursor-pointer text-[var(--text-primary)]"
            >
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* B2B Contacts with masking */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-5 shadow-sm space-y-4">
        <h3 className="font-heading font-extrabold text-base border-b border-[var(--border-card)] pb-3 text-[var(--text-primary)]">Client Contact PII</h3>
        
        <div className="space-y-3.5">
          <div>
            <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Contact Person</span>
            <span className="font-semibold text-sm mt-0.5 block text-[var(--text-primary)]">{selectedEnquiry.contactName}</span>
          </div>

          <div>
            <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Email Address</span>
            <div className="flex items-center justify-between gap-2 mt-0.5">
              <span className="text-sm font-semibold truncate text-[var(--text-primary)]">
                {unmasked ? (
                  selectedEnquiry.contactEmail
                ) : (
                  <span className="font-mono tracking-wider bg-[var(--bg-input)] px-2 py-0.5 rounded text-xs text-[var(--text-secondary)]">{maskEmail(selectedEnquiry.contactEmail)}</span>
                )}
              </span>
              <button onClick={() => setUnmasked(!unmasked)} className="text-xs font-bold text-brand-indigo hover:underline flex-shrink-0 cursor-pointer bg-transparent border-0">
                {unmasked ? "Hide" : "Reveal"}
              </button>
            </div>
          </div>

          <div>
            <span className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Phone Number</span>
            <div className="flex items-center justify-between gap-2 mt-0.5">
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {unmasked ? (
                  selectedEnquiry.contactPhone || "Not provided"
                ) : (
                  <span className="font-mono tracking-wider bg-[var(--bg-input)] px-2 py-0.5 rounded text-xs text-[var(--text-secondary)]">{maskPhone(selectedEnquiry.contactPhone)}</span>
                )}
              </span>
              <button onClick={() => setUnmasked(!unmasked)} className="text-xs font-bold text-brand-indigo hover:underline flex-shrink-0 cursor-pointer bg-transparent border-0">
                {unmasked ? "Hide" : "Reveal"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
