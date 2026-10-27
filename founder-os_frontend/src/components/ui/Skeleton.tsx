import React from "react";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-[var(--radius-sm)] ${className}`} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border-card)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow-soft)] md:p-6">
      <Skeleton className="mb-4 h-4 w-1/3" />
      <Skeleton className="mb-3 h-8 w-1/2" />
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </div>
    </div>
  );
}
