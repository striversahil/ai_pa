"use client";

// Extracted verbatim from FieldStaffPanel.tsx by scripts/refactor/split-module.mjs.
// FieldStaffPanel.tsx re-exports everything public here, so existing imports keep working.
import { isVisitOpen } from "@/field-staff/types";
import type { FieldVisit } from "@/field-staff/types";

export function StatusDot({ v }: { v: FieldVisit }) {
  if (isVisitOpen(v)) {
    return (
      <span className="relative flex h-2.5 w-2.5 flex-shrink-0" title="Open visit — active location">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
      </span>
    );
  }
  return <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-zinc-400" title="Checked out" />;
}
