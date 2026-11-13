"use client";

// OrgPositionPicker — the organization chart as a selectable tree.
//
// Founder decision 2026-11-13: this REPLACES the free-text Designation +
// Department inputs in the employee add/edit form. HR matches a person to a
// chart position (so seats, tree and reporting never drift), and sees what the
// position is responsible for while choosing.
//
// Presentational only: no fetch, no state beyond expand/collapse.
import { useMemo, useState } from "react";
import {
  buildOrgTree, isOrgTitle, loginPositionsFor, orgPosition, responsibilityLine, suggestOrgTitle,
  type OrgTreeNode,
} from "@/hr/organization";

const chip = "rounded-full px-1.5 py-0.5 text-[10px] font-bold";

function NodeRow({ node, depth, selected, current, onPick }: {
  node: OrgTreeNode;
  depth: number;
  selected: string;
  current: string;
  onPick: (title: string, department: string | null) => void;
}) {
  const isSelected = selected === node.title;
  const hasLogin = node.isTop || loginPositionsFor(node.title).length > 0;
  return (
    <button
      type="button"
      onClick={() => onPick(node.title, node.department)}
      title={node.isTop ? "Top of the chart" : responsibilityLine({
        title: node.title,
        department: node.department ?? "",
        reportsTo: node.reportsTo ?? "",
        leads: node.leads,
        isHead: node.isHead,
      })}
      className={`group flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors ${
        isSelected
          ? "border-indigo-500 bg-indigo-500/10"
          : "border-transparent hover:border-zinc-300 hover:bg-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
      }`}
      style={{ marginLeft: depth * 14 }}
    >
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${node.isTop ? "bg-zinc-400" : node.isHead ? "bg-indigo-500" : "bg-zinc-300 dark:bg-zinc-600"}`} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-zinc-800 dark:text-zinc-100">{node.title}</span>
          {node.isTop && <span className={`${chip} bg-zinc-500/15 text-zinc-500`}>Top</span>}
          {node.isHead && !node.isTop && <span className={`${chip} bg-indigo-500/15 text-indigo-500`}>Head</span>}
          {current === node.title && <span className={`${chip} bg-emerald-500/15 text-emerald-600 dark:text-emerald-400`}>Current</span>}
          {!hasLogin && !node.isTop && <span className={`${chip} bg-amber-500/15 text-amber-600 dark:text-amber-400`}>no dashboard</span>}
        </span>
        {!node.isTop && (
          <span className="mt-0.5 block truncate text-[10px] text-zinc-500">
            {node.department} · {responsibilityLine({
              title: node.title,
              department: node.department ?? "",
              reportsTo: node.reportsTo ?? "",
              leads: node.leads,
              isHead: node.isHead,
            })}
          </span>
        )}
      </span>
    </button>
  );
}

function TreeBranch({ node, depth, selected, current, onPick }: {
  node: OrgTreeNode;
  depth: number;
  selected: string;
  current: string;
  onPick: (title: string, department: string | null) => void;
}) {
  const [open, setOpen] = useState(true);
  if (node.isTop) {
    // The top position is a header, not a selectable seat.
    return (
      <div className="space-y-0.5">
        <div className="flex items-center gap-2 px-2 py-1">
          <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-zinc-400">{node.title}</span>
          <span className="text-[10px] text-zinc-500">· top of the chart</span>
        </div>
        {node.children.map((child) => (
          <TreeBranch key={child.title} node={child} depth={0} selected={selected} current={current} onPick={onPick} />
        ))}
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center gap-1">
        {node.children.length > 0 ? (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-label={open ? "Collapse" : "Expand"}
            className="w-4 shrink-0 text-[10px] font-bold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <NodeRow node={node} depth={depth} selected={selected} current={current} onPick={onPick} />
        </div>
      </div>
      {open && node.children.map((child) => (
        <TreeBranch key={child.title} node={child} depth={depth + 1} selected={selected} current={current} onPick={onPick} />
      ))}
    </div>
  );
}

export default function OrgPositionPicker({ designation, department, onChange }: {
  designation: string;
  department: string;
  onChange: (next: { title: string; department: string }) => void;
}) {
  const tree = useMemo(() => buildOrgTree(), []);
  const known = isOrgTitle(designation);
  const suggested = useMemo(() => (known ? null : suggestOrgTitle(designation)), [designation, known]);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-zinc-500">
          {known
            ? <>Position: <span className="font-bold text-zinc-700 dark:text-zinc-200">{designation}</span>{department ? ` · ${department}` : ""}</>
            : designation
              ? <>Legacy free text <span className="font-bold text-amber-600 dark:text-amber-400">“{designation}”</span> — pick a chart position to normalize</>
              : "Pick the position this person occupies in the chart"}
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">chart position</span>
      </div>
      {suggested && (
        <button
          type="button"
          onClick={() => onChange({ title: suggested, department: orgPosition(suggested)?.department ?? "" })}
          className="flex w-full items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-left text-[11px] text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
        >
          <span className="font-extrabold uppercase tracking-wide">Suggested</span>
          <span>“{designation}” reads as <b>{suggested}</b> — click to use, or pick another position below.</span>
        </button>
      )}
      <div className="max-h-72 overflow-y-auto rounded-xl border border-zinc-200 p-1.5 dark:border-zinc-800">
        <TreeBranch
          node={tree}
          depth={0}
          selected={known ? designation : ""}
          current={designation}
          onPick={(title, dept) => onChange({ title, department: dept ?? "" })}
        />
      </div>
    </div>
  );
}
