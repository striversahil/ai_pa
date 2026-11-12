"use client";

// Extracted verbatim from ProductLineDashboard.tsx by scripts/refactor/split-module.mjs.
// ProductLineDashboard.tsx re-exports everything public here, so existing imports keep working.
import React from "react";
import { X } from "lucide-react";
import { panel, iconBtn } from "./helpers";

/* ── Shared modal chrome ── */
export function ModalShell({ title, onClose, narrow, children }: { title: string; onClose: () => void; narrow?: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-[2px]" onClick={onClose}>
      <div className={`${panel} w-full ${narrow ? "max-w-sm" : "max-w-md"} max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-[var(--border-card)]/70 sticky top-0 bg-[var(--bg-card)] rounded-t-2xl">
          <h3 className="flex-1 font-extrabold tracking-tight text-[var(--text-primary)]">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className={iconBtn}><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-3.5">{children}</div>
      </div>
    </div>
  );
}
