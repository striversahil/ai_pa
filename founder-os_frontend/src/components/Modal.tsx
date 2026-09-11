"use client";

import React, { useEffect } from "react";

interface ModalProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}

// Generic overlay modal: ESC/backdrop close, body scroll lock, roomy panel.
export default function Modal({ title, subtitle, onClose, children, wide = false }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? "sm:max-w-4xl" : "sm:max-w-2xl"} max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] shadow-2xl`}
      >
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-[var(--border-card)] flex-shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="font-heading font-extrabold text-base text-[var(--text-primary)] truncate">{title}</h2>
            {subtitle && <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-bold cursor-pointer border-0"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {children}
        </div>
      </div>
    </div>
  );
}
