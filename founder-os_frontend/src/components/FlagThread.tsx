"use client";

import React from "react";
import type { FlagThreadEntry } from "@/types";
import { historyDateChip } from "@/types";

const KIND_STYLE: Record<FlagThreadEntry["kind"], string> = {
  flag: "bg-red-500",
  remark: "bg-zinc-400",
  fix: "bg-emerald-500",
  request: "bg-indigo-500",
  quoted: "bg-amber-500",
};

const KIND_LABEL: Record<FlagThreadEntry["kind"], string> = {
  flag: "Flagged",
  remark: "Remark",
  fix: "Fixed",
  request: "Requested rates",
  quoted: "Quoted",
};

const BY_LABEL: Record<FlagThreadEntry["by"], string> = {
  sales: "Sales",
  procurement: "Procurement",
  management: "Management",
};

// Shared back-and-forth trail: every flag, remark, fix and request on one
// item, oldest first. Read-only everywhere — entries are server-authored,
// remarks are appended by the sales remark box. hideSalesRemarks drops
// free-text sales remarks in PII-redacted views (flag/fix/request lines are
// workflow metadata and always safe).
export default function FlagThread({ thread, hideSalesRemarks = false, tone = "auto" }: { thread: FlagThreadEntry[]; hideSalesRemarks?: boolean; tone?: "auto" | "dark" }) {
  const all = Array.isArray(thread) ? thread : [];
  const entries = hideSalesRemarks ? all.filter((e) => !(e.by === "sales" && e.kind === "remark")) : all;
  if (entries.length === 0) return null;
  const dark = tone === "dark";
  const titleCls = dark ? "text-zinc-100" : "text-[var(--text-primary)]";
  const bodyCls = dark ? "text-zinc-400" : "text-[var(--text-secondary)]";
  const timeCls = dark ? "text-zinc-500" : "text-[var(--text-tertiary)]";
  return (
    <ul className="mt-1.5 space-y-1.5 border-l-2 border-[var(--border-card)] pl-2.5">
      {entries.map((e, i) => (
        <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
          <span className={`mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full ${KIND_STYLE[e.kind] ?? "bg-zinc-400"}`} />
          <span className="min-w-0">
            <span className={`font-extrabold ${titleCls}`}>
              {BY_LABEL[e.by] ?? e.by} · {KIND_LABEL[e.kind] ?? e.kind}
            </span>
            {e.at && (
              <span className={`ml-1.5 text-[10px] ${timeCls}`}>{historyDateChip(e.at)}</span>
            )}
            <span className={`block ${bodyCls} whitespace-pre-wrap break-words`}>{e.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
