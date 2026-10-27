"use client";

import React, { useEffect } from "react";

/**
 * Fullscreen inline PDF viewer used by the HR hiring kit (and CRM document
 * lists). Same big-view UX as the team-chat lightbox: iframe preview, ESC or
 * backdrop to close, explicit download.
 */
export default function PdfViewer({
  url,
  name,
  onClose,
}: {
  url: string;
  name?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const label = name || "Document.pdf";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <button
        className="absolute right-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white transition-colors hover:text-zinc-400"
        onClick={onClose}
        type="button"
        title="Close"
        aria-label="Close"
      >
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div
        className="flex max-h-[92vh] max-w-[95vw] flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <iframe
          src={url}
          title={label}
          className="h-[85vh] w-[90vw] rounded-lg border border-white/10 bg-white"
        />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="max-w-[70vw] truncate rounded-full bg-black/50 px-3 py-1 text-xs font-semibold text-white">
            {label}
          </span>
          <a
            href={url}
            download={label}
            className="rounded-full bg-brand-indigo px-3 py-1 text-xs font-bold text-white"
          >
            Download
          </a>
        </div>
      </div>
    </div>
  );
}
