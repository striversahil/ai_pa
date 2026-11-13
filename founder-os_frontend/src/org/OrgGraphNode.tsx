"use client";

// OrgGraphNode — one chart position as a React Flow node.
//
// Face only: title, department colour, live seats + login dots. Click selects
// (pins the inspector rail); hover previews. All detail lives in the rail,
// so the canvas stays readable at any zoom.
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { OrgPerson } from "@/org/api";

export interface OrgNodeData extends Record<string, unknown> {
  title: string;
  department: string | null;
  isTop: boolean;
  people: OrgPerson[];
  selected: boolean;
}

export const DEPT_STYLES: Record<string, { ring: string; bar: string; chip: string }> = {
  Sales: {
    ring: "border-indigo-500/60",
    bar: "bg-indigo-500",
    chip: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300",
  },
  "Digital Marketing": {
    ring: "border-fuchsia-500/60",
    bar: "bg-fuchsia-500",
    chip: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300",
  },
  Accounts: {
    ring: "border-emerald-500/60",
    bar: "bg-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  },
  "Operations & Support": {
    ring: "border-amber-500/60",
    bar: "bg-amber-500",
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  },
};

const FALLBACK = { ring: "border-zinc-400/50", bar: "bg-zinc-400", chip: "bg-zinc-500/10 text-zinc-500" };

function OrgGraphNode({ data }: NodeProps) {
  const d = data as unknown as OrgNodeData;
  const active = d.people.filter((p) => p.employee.active);
  const logins = active.filter((p) => p.login).length;
  const style = (d.department && DEPT_STYLES[d.department]) || FALLBACK;
  return (
    <div
      className={`w-[228px] rounded-2xl border-2 bg-white shadow-sm transition-shadow dark:bg-zinc-950 ${
        d.selected ? "border-indigo-500 shadow-lg shadow-indigo-500/20" : style.ring
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0" />
      <div className={`h-1.5 rounded-t-2xl ${d.isTop ? "bg-zinc-800 dark:bg-zinc-200" : style.bar}`} />
      <div className="px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-[13px] font-extrabold text-zinc-900 dark:text-zinc-100">{d.title}</div>
          <span className="flex shrink-0 items-center gap-1" title={`${logins} of ${active.length} seats have a login`}>
            <span className={`h-2 w-2 rounded-full ${logins > 0 ? "bg-emerald-500" : active.length > 0 ? "bg-amber-400" : "bg-zinc-300 dark:bg-zinc-700"}`} />
            <span className="text-[11px] font-bold text-zinc-500">{logins}/{active.length}</span>
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          {d.department ? (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${style.chip}`}>{d.department}</span>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">top</span>
          )}
          <span className="text-[10px] text-zinc-400">
            {active.length === 0 ? "Vacant" : `${active.length} seat${active.length === 1 ? "" : "s"}`}
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0" />
    </div>
  );
}

export default memo(OrgGraphNode);
