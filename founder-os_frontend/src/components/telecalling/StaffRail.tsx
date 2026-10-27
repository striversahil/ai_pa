"use client";

// StaffRail — the telecallers of a region, hanging off a connector rail.
//
// These are ALWAYS-VISIBLE children of their region (founder decision): nobody
// should have to switch a tab to see who is actually selling. Deliberately NO
// per-agent won count or ₹ — accepted value belongs to the REGION's estimates,
// and personal money rows would read as double counting against the region
// total. Activity (calls / leads / talk), risk pips and points only.

import React from "react";
import { ChevronDown, UserRound, Zap } from "lucide-react";
import type { BoardStaff } from "@/telecalling/view-types";
import { fmtNum, fmtTalk, initials } from "@/telecalling/format";
import { TRAFFIC_TONE } from "@/telecalling/tone";
import { FOCUS, LABEL, PILL } from "./surface";

export interface StaffRailProps {
  staff: BoardStaff[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  /** Region pipeline drawer — supplied by the page (needs the drill payload). */
  renderPipeline: (staff: BoardStaff) => React.ReactNode;
  /** Region id/name for the empty state copy. */
  regionId: string;
  regionName?: string;
}

function MicroBar({ pct, tone }: { pct: number; tone: "green" | "amber" | "red" }) {
  return (
    <span className="inline-block h-[3px] w-8 overflow-hidden rounded-full bg-[var(--border-card)]" aria-hidden="true">
      <span
        className={`block h-full rounded-full ${TRAFFIC_TONE[tone].rail} transition-[width] duration-700 ease-out`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </span>
  );
}

export function StaffRail({ staff, expandedId, onToggle, renderPipeline, regionId, regionName }: StaffRailProps) {
  if (staff.length === 0) {
    return (
      <div className="border-t border-[var(--border-card)] px-2.5 py-1.5 md:px-3">
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--border-card)] bg-[var(--surface-sunken)] px-3 py-2">
          <UserRound className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
          <p className="text-[11px] font-semibold text-[var(--text-tertiary)]">
            No active telecallers mapped to {regionName || regionId} — the daily ₹1,00,000 still accrues.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--border-card)] px-2.5 py-1.5 md:px-3">
      <div className="mb-0.5 flex items-center justify-between gap-2 px-1">
        <span className={LABEL}>Telecallers · {staff.length}</span>
      </div>

      <ul className="relative space-y-0.5 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-[var(--border-card)]">
        {staff.map((s, i) => {
          const open = expandedId === s.id;
          const isField = s.type === "field_staff";

          return (
            <li key={s.id} className="fos-rise" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
              <button
                type="button"
                onClick={() => onToggle(s.id)}
                aria-expanded={open}
                aria-controls={`pipeline-${s.id}`}
                title={open ? "Hide region pipeline" : "Show region pipeline"}
                className={`group flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-[var(--surface-sunken)] ${FOCUS} ${open ? "bg-[var(--surface-sunken)]" : ""}`}
              >
                <span className="relative z-10 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[var(--border-card)] bg-[var(--bg-card)] text-[8px] font-extrabold text-indigo-600 dark:text-indigo-300">
                  {initials(s.name)}
                </span>

                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[12px] font-semibold leading-4 text-[var(--text-primary)]">{s.name}</span>
                  {s.tlLevel && (
                    <span className="rounded-full border border-[var(--border-card)] px-1.5 text-[9px] font-bold text-[var(--text-tertiary)]">
                      {s.tlLevel}
                    </span>
                  )}
                  {isField && (
                    <span className={`${PILL} border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300`}>Field</span>
                  )}
                </span>

                <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-[var(--text-secondary)]" title={`${s.generation.callsConnected} connected of ${s.generation.connectedTarget} target`}>
                    {fmtNum(s.generation.callsConnected)}
                    <span className="text-[9px] font-bold text-[var(--text-tertiary)]">calls</span>
                    <MicroBar pct={s.generation.connectedPct} tone={s.generation.connectedStatus} />
                  </span>
                  <span className="hidden items-center gap-1 font-mono text-[11px] font-semibold text-[var(--text-secondary)] md:inline-flex" title={`${s.generation.leadsGenerated} leads of ${s.generation.leadsTarget} target`}>
                    {fmtNum(s.generation.leadsGenerated)}
                    <span className="text-[9px] font-bold text-[var(--text-tertiary)]">leads</span>
                    <MicroBar pct={s.generation.leadsPct} tone={s.generation.leadsStatus} />
                  </span>
                  <span className="hidden font-mono text-[11px] font-semibold text-[var(--text-tertiary)] lg:inline" title="Talk time">
                    {isField ? "—" : fmtTalk(s.generation.talkTimeSec)}
                  </span>
                </span>

                <span className="ml-auto inline-flex shrink-0 items-center gap-1.5">
                  <span className="inline-flex items-center gap-0.5 rounded-full border border-indigo-500/25 bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-indigo-700 dark:text-indigo-300" title="Composite score = close points + 15/lead + 0.5/connected call">
                    <Zap className="h-2.5 w-2.5" aria-hidden="true" />
                    {fmtNum(s.score)}
                  </span>
                  <ChevronDown className={`h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                </span>
              </button>

              {/* Pipeline drawer — content supplied by the page (drill payload). */}
              <div id={`pipeline-${s.id}`} className={`grid transition-all duration-200 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                <div className="overflow-hidden">
                  <div className="ml-[12px] border-l border-[var(--border-card)] pb-0.5 pl-2.5 pr-1 pt-0.5">
                    {open ? renderPipeline(s) : null}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default StaffRail;
