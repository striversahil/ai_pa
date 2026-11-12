"use client";

// Extracted verbatim from OrderPanel.tsx by scripts/refactor/split-module.mjs.
// OrderPanel.tsx re-exports everything public here, so existing imports keep working.
import type { CrmProofFile } from "../types";
import { EmptyProofDoc } from "./EmptyProofDoc";
import { isPhotoFile, isPdfFile } from "./helpers";

/** One document on a consumed proof: photo miniature or PDF tile, both opening
 *  the shared big-view components (Lightbox for images, PdfViewer for PDFs) —
 *  the same UX as the SO documents list and management review. */
export function ProofDoc({
  file,
  label,
  onOpen,
}: {
  file: CrmProofFile | null;
  label: string;
  onOpen: (file: CrmProofFile) => void;
}) {
  if (!file || !file.url) return <EmptyProofDoc label={label} />;
  const photo = isPhotoFile(file);
  const pdf = isPdfFile(file);
  return (
    <button
      type="button"
      onClick={() => onOpen(file)}
      title={`${label}${file.fileName ? ` — ${file.fileName}` : ""}`}
      className="group/doc flex w-[68px] cursor-zoom-in flex-col items-center gap-1 border-0 bg-transparent p-0"
    >
      {photo ? (
        <img
          src={file.url}
          alt={file.fileName || label}
          loading="lazy"
          className="h-12 w-12 rounded-lg border border-zinc-200 object-cover transition-transform group-hover/doc:scale-[1.06] dark:border-zinc-700"
        />
      ) : (
        <span
          className={`flex h-12 w-12 items-center justify-center rounded-lg border text-lg ${
            pdf
              ? "border-red-500/30 bg-red-500/10"
              : "border-zinc-200 bg-zinc-500/10 dark:border-zinc-700"
          }`}
        >
          {pdf ? "📕" : "📄"}
        </span>
      )}
      <span className="w-full truncate text-center text-[9px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span className="w-full truncate text-center text-[9px] text-zinc-400 group-hover/doc:text-indigo-500">
        {file.fileName || (pdf ? "PDF" : "Open")}
      </span>
    </button>
  );
}
