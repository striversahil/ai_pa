"use client";

// DispatchSkeleton — list placeholder for BOTH dispatch surfaces (the CRM
// floor and Sales → Dispatch).
//
// Why it exists: `useLiveQuery` keeps the previous payload while a `deps`
// change loads (that is what makes a live event refresh invisible), so a tab,
// region, search or page switch used to render the PREVIOUS query's orders
// under an in-flight request — stale rows for a second, then a jump. The
// shimmer owns the slot instead: `list.loading` is exactly "a different
// dataset is loading" (force), while live refetches stay on `refreshing` and
// never blank the list.
import React from "react";
import { Skeleton } from "@/components/ui/Skeleton";

export function DispatchSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" aria-busy="true" aria-label="Loading sales orders">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-[104px] rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3.5 shadow-[var(--shadow-card)]"
        >
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-5 w-24 rounded-full!" />
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="mt-3.5 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
