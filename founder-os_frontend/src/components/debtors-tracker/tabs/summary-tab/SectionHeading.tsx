"use client";

// Extracted verbatim from SummaryTab.tsx by scripts/refactor/split-module.mjs.
// SummaryTab.tsx re-exports everything public here, so existing imports keep working.
import type { ReactNode } from "react";
import type { Accent } from "./types";
import { ACCENTS } from "./helpers";

export function SectionHeading({
  eyebrow, title, description, accent, icon, right,
}: {
  eyebrow: string;
  title: string;
  description: string;
  accent: Accent;
  icon: "receivables" | "collections";
  right?: ReactNode;
}) {
  const a = ACCENTS[accent];
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-10 w-10 place-items-center rounded-xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 ${a.icon}`}>
          {icon === "receivables" ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M7 3.75h7l3.5 3.5V20a.25.25 0 0 1-.25.25H7.25A.25.25 0 0 1 7 20V4a.25.25 0 0 1 .25-.25Z" strokeLinejoin="round" />
              <path d="M14 3.75V7.5h3.75M9.5 11.5h5M9.5 15h5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3.75 7.5h16.5v9H3.75z" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="2.25" />
              <path d="M6.5 7.5v9M17.5 7.5v9" strokeLinecap="round" opacity=".45" />
            </svg>
          )}
        </span>
        <div>
          <div className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${a.icon}`}>{eyebrow}</div>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
        </div>
      </div>
      {right}
    </div>
  );
}
