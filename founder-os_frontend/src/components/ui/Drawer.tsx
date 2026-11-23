"use client";

// Drawer.tsx — the shared right-side sheet for record detail/edit surfaces.
//
// House rule (dup-audit `fe.adhoc_modal_overlay`): never hand-roll
// `fixed inset-0` overlays. Product Line's product + rate editors use this.
// ESC closes, the backdrop closes, body scroll locks while open.
import React, { useEffect } from "react";
import { X } from "lucide-react";

interface DrawerProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  /** Tailwind max-width class for the panel, e.g. `max-w-3xl`. */
  width?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}

export function Drawer({ title, subtitle, onClose, width = "max-w-2xl", headerRight, children }: DrawerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <aside
        className={`w-full ${width} h-full overflow-y-auto bg-[var(--bg-card)] border-l border-[var(--border-card)] shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center gap-2 px-5 py-3.5 bg-[var(--bg-card)] border-b border-[var(--border-card)]">
          <div className="min-w-0">
            <h3 className="font-extrabold tracking-tight text-[var(--text-primary)] truncate">{title}</h3>
            {subtitle ? <p className="text-[11px] text-[var(--text-tertiary)] truncate">{subtitle}</p> : null}
          </div>
          {headerRight ? <div className="ml-auto flex items-center gap-1.5">{headerRight}</div> : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`inline-flex items-center justify-center h-8 w-8 rounded-lg hover:bg-[var(--bg-input)] text-[var(--text-tertiary)] ${headerRight ? "" : "ml-auto"}`}
          >
            <X size={16} />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}

export default Drawer;
