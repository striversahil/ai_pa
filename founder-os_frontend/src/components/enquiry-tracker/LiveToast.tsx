import React from "react";
import { Button, Badge, toneClasses } from "@/components/ui";
import type { Tone } from "@/components/ui";

export type LiveToastKind = "rates" | "spec" | "specdiff" | "reopened" | "loop";
export interface LiveToastData { id: string; label: string; title: string; kind: LiveToastKind }

const META: Record<LiveToastKind, { tone: Tone; icon: string; heading: string; cta: string }> = {
  rates: { tone: "success", icon: "₹", heading: "Rates ready", cta: "View rates" },
  spec: { tone: "danger", icon: "!", heading: "Spec flagged — correction needed", cta: "View item" },
  specdiff: { tone: "warning", icon: "≠", heading: "Vendor quoted a different spec", cta: "View item" },
  reopened: { tone: "warning", icon: "↻", heading: "New vendor rates — decision reopened", cta: "View item" },
  loop: { tone: "sky", icon: "…", heading: "New loop update", cta: "View item" },
};

// Live intimation toast for the sales enquiry board (rates ready, spec flag,
// late quote reopen, loop update). Presentational — EnquiryTracker owns timing.
export default function LiveToast({ toast, onOpen, onDismiss }: { toast: LiveToastData; onOpen: () => void; onDismiss: () => void }) {
  const m = META[toast.kind];
  return (
    <div role="status" className="fixed bottom-5 right-5 z-50 w-[min(24rem,calc(100vw-2.5rem))] rounded-[var(--radius-card)] border border-[var(--border-card)] bg-[var(--bg-card)] p-4 shadow-[var(--shadow-float)] animate-scale-up">
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-base font-bold ${toneClasses[m.tone]}`}>{m.icon}</span>
        <div className="min-w-0 flex-1">
          <Badge tone={m.tone}>{m.heading}</Badge>
          <p className="mt-1.5 truncate text-label font-semibold text-[var(--text-primary)]">{toast.title}</p>
          <p className="text-caption font-medium text-[var(--color-brand-indigo)]">{toast.label}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="primary" onClick={onOpen}>{m.cta}</Button>
            <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
