"use client";

// CopilotChat — generic department copilot (thin adapter over CopilotView).
//
// One component, many departments: the caller passes a CopilotConfig and,
// optionally, mode tabs. Transport, chaining, thinking, confirm flow, and
// chrome all live in src/copilot/* — shared verbatim with the sales copilot.
// Backend mirror: founder-os_backend/src/copilot/registry.ts
import React from "react";
import SpecForm from "./SpecForm";
import CopilotView from "../copilot/CopilotView";
import type { CopilotMsg } from "../copilot/types";
import type { ProposalApi } from "../copilot/useCopilotTurn";

export interface CopilotConfig {
  title: string;
  subtitle: string;
  emptyText: string;
  suggestions: string[];
  toolIcons: Record<string, string>;
  streamUrl: string;
  chatUrl: string;
  /** Absent = read-only copilot (no Confirm & apply cards). */
  executeUrl?: string;
  /** Chat clears whenever this changes (e.g. selected enquiry/product id). */
  resetKey: string | number;
  userInitial?: string;
  /** Per-request abort budget ms (default 60000). 0 or negative = no timer. */
  timeoutMs?: number;
  /** Extra body fields sent with every message (e.g. { batchId } for bulk). */
  context?: Record<string, string>;
}

export default function CopilotChat({ config, open, onClose, onOpen, chrome = "full", modes, mode, onModeChange, headerExtra }: {
  config: CopilotConfig;
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  /** "full" = popup + bottom pill; "popup" = popup only (caller renders its own launcher). */
  chrome?: "full" | "popup";
  /** Mode tabs shown inside the popup header (e.g. Knowledge | Add Rates). */
  modes?: { id: string; label: string }[];
  /** Rendered inside the popup below the mode tabs (e.g. bulk batch picker). */
  headerExtra?: React.ReactNode;
  mode?: string;
  onModeChange?: (id: string) => void;
}) {
  const renderProposals = (m: CopilotMsg, mi: number, api: ProposalApi) => {
    if (!m.proposals || m.proposals.length === 0) return null;
    return (
      <>
        <div className="space-y-2">
          {m.proposals.filter((p) => p.kind === "spec_form" && Array.isArray(p.questions) && p.questions.length > 0).map((p, pi) => (
            <SpecForm
              key={`spec-${pi}`}
              title={p.title || p.label}
              questions={p.questions!.map((q) => ({
                key: q.key,
                label: q.label,
                type: (q.type === "options" || q.type === "multiselect" || q.type === "number" || q.type === "date" ? q.type : "text") as "options" | "multiselect" | "text" | "number" | "date",
                options: Array.isArray(q.options) ? (q.options as string[]) : [],
                required: q.required !== false,
                section: "spec",
              }))}
              onSubmit={(t) => api.send(t)}
            />
          ))}
        </div>
        {config.executeUrl && (
          <div className="space-y-2">
            {m.proposals.map((p, pi) => {
              const key = mi * 100 + pi;
              const done = api.confirmed.has(key);
              return (
                <div key={pi} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="font-bold text-[13px] text-[var(--text-primary)]">{p.label}</p>
                  {(p.text || p.spec) && <p className="mt-1.5 text-[13px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{p.text || p.spec}</p>}
                  {Array.isArray(p.table?.rows) && p.table.rows.length > 0 && (
                    <div className="mt-2 overflow-x-auto rounded-lg border border-white/10">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr>
                            {(p.table.columns ?? Object.keys(p.table.rows[0] ?? {})).map((c: string) => (
                              <th key={c} className="px-2 py-1.5 text-left font-extrabold text-[var(--text-tertiary)] border-b border-white/10 whitespace-nowrap">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {p.table.rows.map((r: Record<string, string>, ri: number) => (
                            <tr key={ri} className="border-b border-white/[0.04] last:border-0">
                              {(p.table!.columns ?? Object.keys(r)).map((c: string) => (
                                <td key={c} className="px-2 py-1.5 text-[var(--text-secondary)] align-top">{String(r?.[c] ?? "—")}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <button type="button" disabled={done || api.applying.has(key)} onClick={() => api.confirm(mi, pi, p)} className="mt-3 px-4 py-2 text-[13px] font-bold rounded-full bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 cursor-pointer border-0 transition-colors duration-200">
                    {api.applying.has(key) ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-3 w-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                        Applying…
                      </span>
                    ) : done ? "✓ Applied" : "Confirm & apply →"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  };

  return (
    <CopilotView
      endpoints={{
        streamUrl: config.streamUrl,
        chatUrl: config.chatUrl,
        executeUrl: config.executeUrl,
        timeoutMs: config.timeoutMs,
        resetKey: config.resetKey,
        sessionMode: "volatile",
        extraBody: config.context,
        // No server wipe: rotation alone guarantees freshness (server memory
        // is keyed under the volatile id; old threads expire by TTL).
      }}
      view={{
        title: config.title,
        subtitle: config.subtitle,
        emptyText: config.emptyText,
        suggestions: config.suggestions,
        toolIcons: config.toolIcons,
        userInitial: config.userInitial,
        chrome,
        modes,
        mode,
        onModeChange,
        headerExtra,
        resetTitle: "New chat",
      }}
      open={open}
      onClose={onClose}
      onOpen={onOpen}
      renderProposals={renderProposals}
    />
  );
}
