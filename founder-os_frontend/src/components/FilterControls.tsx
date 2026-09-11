import React from "react";
import { Agent, ENQUIRY_SOURCES } from "../mockData";

interface FilterControlsProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  agentFilter: string;
  setAgentFilter: (agent: string) => void;
  agents: Agent[];
  hideAgentFilter?: boolean;
  sourceFilter?: string;
  setSourceFilter?: (source: string) => void;
  ratesFilter?: string;
  setRatesFilter?: (rates: string) => void;
}

export default function FilterControls({
  searchQuery,
  setSearchQuery,
  agentFilter,
  setAgentFilter,
  agents,
  hideAgentFilter = false,
  sourceFilter = "all",
  setSourceFilter,
  ratesFilter = "all",
  setRatesFilter
}: FilterControlsProps) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-4 flex flex-col md:grid md:grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 items-stretch md:items-center">
      {/* Search Input */}
      <div className="relative">
        <svg className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input 
          type="text" 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={hideAgentFilter ? "Search by title..." : "Search by client, title or contact name..."} 
          className="w-full pl-11 pr-4 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl text-sm placeholder-[var(--text-tertiary)] text-[var(--text-primary)] focus:outline-hidden focus:border-brand-indigo/80"
        />
      </div>

      {/* Lead Filter — hidden in procurement view (no lead attribution) */}
      {!hideAgentFilter && (
      <div>
        <select 
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl text-sm text-[var(--text-secondary)] focus:outline-hidden focus:border-brand-indigo/80 cursor-pointer"
        >
          <option value="all">All Leads</option>
          {agents.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      )}

      {/* Rates Filter — sales view only */}
      {setRatesFilter && (
      <div>
        <select
          value={ratesFilter}
          onChange={(e) => setRatesFilter(e.target.value)}
          className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl text-sm text-[var(--text-secondary)] focus:outline-hidden focus:border-brand-indigo/80 cursor-pointer"
        >
          <option value="all">All Rates</option>
          <option value="ready">Rates Ready</option>
          <option value="awaiting">Awaiting Rates</option>
        </select>
      </div>
      )}

      {/* Source Filter — sales view only */}
      {setSourceFilter && (
      <div>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl text-sm text-[var(--text-secondary)] focus:outline-hidden focus:border-brand-indigo/80 cursor-pointer"
        >
          <option value="all">All Sources</option>
          {ENQUIRY_SOURCES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      )}
    </div>
  );
}
