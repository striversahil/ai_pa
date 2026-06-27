import React from "react";
import { Agent } from "../mockData";

interface FilterControlsProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  statusFilter: string;
  setStatusFilter: (status: string) => void;
  priorityFilter: string;
  setPriorityFilter: (priority: string) => void;
  agentFilter: string;
  setAgentFilter: (agent: string) => void;
  agents: Agent[];
}

export default function FilterControls({
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  priorityFilter,
  setPriorityFilter,
  agentFilter,
  setAgentFilter,
  agents
}: FilterControlsProps) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-4 flex flex-col md:grid md:grid-cols-[2fr_1fr_1fr_1fr] gap-4 items-stretch md:items-center">
      {/* Search Input */}
      <div className="relative">
        <svg className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input 
          type="text" 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by client, title or contact name..." 
          className="w-full pl-11 pr-4 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl text-sm placeholder-[var(--text-tertiary)] text-[var(--text-primary)] focus:outline-hidden focus:border-brand-indigo/80"
        />
      </div>

      {/* Status Filter */}
      <div>
        <select 
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl text-sm text-[var(--text-secondary)] focus:outline-hidden focus:border-brand-indigo/80 cursor-pointer"
        >
          <option value="all">All Stages</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="qualified">Qualified</option>
          <option value="proposal">Proposal</option>
          <option value="negotiation">Negotiation</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>
      </div>

      {/* Priority Filter */}
      <div>
        <select 
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl text-sm text-[var(--text-secondary)] focus:outline-hidden focus:border-brand-indigo/80 cursor-pointer"
        >
          <option value="all">All Priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Agent Filter */}
      <div>
        <select 
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="w-full px-3.5 py-2.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl text-sm text-[var(--text-secondary)] focus:outline-hidden focus:border-brand-indigo/80 cursor-pointer"
        >
          <option value="all">All Agents</option>
          {agents.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
