"use client";

// OrgNodeCard — one position in the live organization tree.
//
// Shows: the position + what it is responsible for, how many ACTIVE employees
// sit in it (from the HR employee master — never the chart's `count`), and the
// dashboard logins that map to it (hover peeks, click pins). Logins with no
// sales-roster row get Map/Link right here (founder decision 2026-11-13: the
// org tree is the one home for login → roster mapping).
import { useState } from "react";
import type { DirectoryRow } from "@/auth/directory";
import type { HrEmployee } from "@/hr/types";
import { initials } from "@/hr/format";
import { isOrgLabelOnly, responsibilityLine, type OrgTreeNode } from "@/hr/organization";
import OrgLoginMapRow from "./OrgLoginMapRow";

const chip = "rounded-full px-1.5 py-0.5 text-[10px] font-bold";
const EMPTY: DirectoryRow[] = [];
const NO_SEATS: HrEmployee[] = [];

export default function OrgNodeCard({ node, depth, seats = NO_SEATS, logins = EMPTY, rosterEmails, canManage, onChanged }: {
  node: OrgTreeNode;
  depth: number;
  seats?: HrEmployee[];
  logins?: DirectoryRow[];
  rosterEmails: Set<string>;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (node.isTop) return null;

  // Logins without a sales-roster row can be mapped (only sales positions have
  // a roster row at all — accountants/DM/HR/procurement logins never need one).
  const mappable = canManage
    ? logins.filter((l) => !rosterEmails.has(l.email.toLowerCase().trim()))
    : EMPTY;
  const vacant = seats.length === 0;
  const line = responsibilityLine({
    title: node.title,
    department: node.department ?? "",
    reportsTo: node.reportsTo ?? "",
    leads: node.leads,
    isHead: node.isHead,
  });

  return (
    <div style={{ marginLeft: depth * 14 }} className="group/pos relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors ${
          open
            ? "border-indigo-500/60 bg-indigo-500/5"
            : "border-zinc-200 bg-white hover:border-indigo-400/60 dark:border-zinc-800 dark:bg-zinc-950"
        }`}
      >
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${vacant ? "bg-zinc-300 dark:bg-zinc-700" : node.isHead ? "bg-indigo-500" : "bg-emerald-500"}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-zinc-800 dark:text-zinc-100">{node.title}</span>
            {node.isHead && <span className={`${chip} bg-indigo-500/15 text-indigo-500`}>Head</span>}
            {vacant
              ? <span className={`${chip} bg-zinc-500/15 text-zinc-500`}>Vacant</span>
              : <span className={`${chip} bg-emerald-500/15 text-emerald-600 dark:text-emerald-400`}>{seats.length} active</span>}
            {logins.length > 0 && <span className={`${chip} bg-sky-500/15 text-sky-600 dark:text-sky-400`}>{logins.length} login{logins.length === 1 ? "" : "s"}</span>}
            {isOrgLabelOnly(node.title) && <span className={`${chip} bg-amber-500/15 text-amber-600 dark:text-amber-400`}>no dashboard</span>}
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-zinc-500">{node.department} · {line}</span>
        </span>
        <span className="shrink-0 text-[10px] font-bold text-zinc-400">{open ? "▴" : "▾"}</span>
      </button>

      {/* Hover peek: dashboard logins, no click needed. Hidden once pinned. */}
      {!open && logins.length > 0 && (
        <div className="pointer-events-none absolute left-8 top-full z-20 hidden w-64 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg group-hover/pos:block dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-zinc-400">Dashboard logins</div>
          {logins.slice(0, 6).map((l) => (
            <div key={l.id} className="truncate text-[11px] text-zinc-600 dark:text-zinc-300">
              {l.name || l.email} <span className="text-zinc-400">· {l.via || l.position || "unmapped"}</span>
            </div>
          ))}
          {logins.length > 6 && <div className="mt-1 text-[10px] text-zinc-400">+{logins.length - 6} more</div>}
        </div>
      )}

      {open && (
        <div className="ml-4 mt-1 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/60 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div>
            <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-zinc-400">In this position ({seats.length})</div>
            {vacant ? (
              <p className="text-[11px] text-zinc-500">Nobody assigned — match an employee to this position in the employee master.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {seats.map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] dark:border-zinc-700 dark:bg-zinc-950">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500/15 text-[8px] font-extrabold text-indigo-500">{initials(s.name)}</span>
                    <span className="font-semibold text-zinc-700 dark:text-zinc-200">{s.name}</span>
                    {s.employeeCode && <span className="text-zinc-400">{s.employeeCode}</span>}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-zinc-400">Dashboard logins ({logins.length})</div>
            {logins.length === 0 ? (
              <p className="text-[11px] text-zinc-500">
                {isOrgLabelOnly(node.title)
                  ? "This position carries no dashboard login — it is an org label only and grants nothing."
                  : "No platform login resolves to this position."}
              </p>
            ) : (
              <div className="space-y-1">
                {logins.map((l) => (
                  <div key={l.id} className="flex flex-wrap items-center justify-between gap-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-zinc-800 dark:bg-zinc-950">
                    <span className="min-w-0 truncate">
                      <span className="font-semibold text-zinc-700 dark:text-zinc-200">{l.name || l.email}</span>
                      <span className="text-zinc-400"> · {l.email}</span>
                    </span>
                    <span className={`${chip} ${rosterEmails.has(l.email.toLowerCase().trim()) ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-zinc-500/15 text-zinc-500"}`}>
                      {rosterEmails.has(l.email.toLowerCase().trim()) ? "on sales roster" : l.via || "mapped"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {mappable.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-extrabold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                Waiting for a sales-roster row ({mappable.length})
              </div>
              {mappable.map((l) => <OrgLoginMapRow key={l.id} row={l} onMapped={onChanged} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
