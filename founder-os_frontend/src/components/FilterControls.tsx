import React from "react";
import { Agent, ENQUIRY_SOURCES } from "../types";
import { Button } from "./ui";

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

const field =
  "h-10 w-full rounded-[var(--radius-control)] border border-[var(--border-card)] bg-[var(--bg-input)] text-label font-medium text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--color-brand-indigo)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-brand-indigo)_18%,transparent)]";
const select = `${field} cursor-pointer px-3 sm:w-auto sm:min-w-[150px]`;

// Search + filter row. Selects render only when their setter is passed
// (sales view); the lead filter hides for identity-redacted viewers.
export default function FilterControls({
  searchQuery, setSearchQuery, agentFilter, setAgentFilter, agents,
  hideAgentFilter = false, sourceFilter = "all", setSourceFilter, ratesFilter = "all", setRatesFilter,
}: FilterControlsProps) {
  const active = (searchQuery ? 1 : 0) + (agentFilter !== "all" ? 1 : 0) + (sourceFilter !== "all" ? 1 : 0);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative min-w-0 flex-1 sm:min-w-[260px]">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={hideAgentFilter ? "Search by title…" : "Search EST No., client, phone, item…"}
          aria-label="Search enquiries"
          className={`${field} pl-9 pr-3 placeholder:text-[var(--text-tertiary)]`}
        />
      </div>

      {setRatesFilter && (
        <select value={ratesFilter} onChange={(e) => setRatesFilter(e.target.value)} className={select} aria-label="Rate status">
          <option value="all">All rate states</option>
          <option value="ready">Rates ready</option>
          <option value="awaiting">Not sent</option>
          <option value="sent">Marked as sent</option>
        </select>
      )}

      {!hideAgentFilter && (
        <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className={select} aria-label="Lead">
          <option value="all">All leads</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}{a.type === "field_staff" ? " · Field Staff" : ""}</option>
          ))}
        </select>
      )}

      {setSourceFilter && (
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={select} aria-label="Source">
          <option value="all">All sources</option>
          {ENQUIRY_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}

      {active > 0 && (
        <Button variant="ghost" onClick={() => { setSearchQuery(""); setAgentFilter("all"); setSourceFilter?.("all"); }}>
          Clear
        </Button>
      )}
    </div>
  );
}
