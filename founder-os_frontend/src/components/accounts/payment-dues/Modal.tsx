"use client";

// Extracted verbatim from PaymentDues.tsx by scripts/refactor/split-module.mjs.
// PaymentDues.tsx re-exports everything public here, so existing imports keep working.
import React from "react";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-start justify-between gap-3">
          <h4 className="font-bold text-zinc-900 dark:text-white">{title}</h4>
          <button onClick={onClose} className="rounded px-2 py-0.5 text-lg leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer" aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
