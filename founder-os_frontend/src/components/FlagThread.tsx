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
export default function FlagThread({ thread, hideSalesRemarks = false, tone = "auto", hideKinds = [] }: { thread: FlagThreadEntry[]; hideSalesRemarks?: boolean; tone?: "auto" | "dark"; hideKinds?: FlagThreadEntry["kind"][] }) {
  const all = Array.isArray(thread) ? thread : [];
  const hidden = new Set(hideKinds);
  const entries = all.filter((e) => !hidden.has(e.kind) && !(hideSalesRemarks && e.by === "sales" && e.kind === "remark"));
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
            {Array.isArray((e as any).media) && (e as any).media.length > 0 && (
              <span className="mt-1 flex flex-wrap gap-1.5">
                {(e as any).media.map((m: any, mi: number) => (
                  m.type === "video" ? (
                    <video key={mi} src={m.url} controls preload="metadata" className="w-24 h-14 rounded-lg object-cover border border-[var(--border-card)] bg-black" />
                  ) : m.type === "pdf" ? (
                    <a key={mi} href={m.url} download={m.name || `thread-${i}-${mi}.pdf`} className="px-2 py-1 rounded-lg border border-[var(--border-card)] bg-red-500/10 hover:bg-red-500/20 text-[10px] font-bold">PDF</a>
                  ) : (
                    <img key={mi} src={m.url} alt={`thread ${mi+1}`} className="w-14 h-14 rounded-lg object-cover border border-[var(--border-card)]" />
                  )
                ))}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
