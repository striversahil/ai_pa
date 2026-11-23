"use client";

// Skeletons.tsx — loading placeholders for the Product Line surfaces.
// The rates sheet is the one that matters: 500-row pages must never flash an
// empty grid, so cells paint as shimmering rows of the same height.
import React from "react";

const bar = "rounded-md bg-[var(--bg-input)] animate-pulse";

export function SheetSkeleton({ rows = 12, cols = 8, compact = false }: { rows?: number; cols?: number; compact?: boolean }) {
  return (
    <div className="divide-y divide-[var(--border-card)]/60" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className={`flex items-center gap-3 ${compact ? "px-2 py-1.5" : "px-4 py-2.5"}`}>
          {Array.from({ length: cols }).map((__, c) => (
            <div
              key={c}
              className={bar}
              style={{ height: compact ? 9 : 12, width: `${[22, 14, 12, 24, 10, 8, 10, 12][c % 8]}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-y divide-[var(--border-card)]/60" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3 px-4 py-3">
          <div className={`${bar} h-3 w-1/4`} />
          <div className={`${bar} h-3 w-16`} />
          <div className={`${bar} h-3 w-1/3`} />
          <div className={`${bar} h-3 w-10 ml-auto`} />
        </div>
      ))}
    </div>
  );
}

export function DrawerSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className={`${bar} h-5 w-2/3`} />
      <div className={`${bar} h-3 w-1/3`} />
      <div className="grid grid-cols-2 gap-3 pt-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className={`${bar} h-2.5 w-20`} />
            <div className={`${bar} h-8 w-full`} />
          </div>
        ))}
      </div>
      <div className={`${bar} h-3 w-1/4 pt-2`} />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <div className={`${bar} h-2.5 w-28`} />
          <div className={`${bar} h-8 w-full`} />
        </div>
      ))}
    </div>
  );
}
