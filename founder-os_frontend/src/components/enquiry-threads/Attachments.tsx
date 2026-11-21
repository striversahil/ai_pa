"use client";
import React, { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { filesToMedia, uploadMediaFile } from "@/lib/imageFiles";
import { MAX_THREAD_ATTACHMENTS, type ThreadAttachment } from "@/enquiry-threads/types";

/** Draft attachments for one composer. Files upload to the enquiry locker as
 *  they are picked (images downscaled first); messages carry only the short
 *  locker URLs. A failed upload is reported, never silently inlined. */
export function useAttachDraft() {
  const [files, setFiles] = useState<ThreadAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true); setError(null);
    const { media, skipped } = await filesToMedia(list);
    const failed = [...skipped];
    const done: ThreadAttachment[] = [];
    for (const m of media) {
      const up = await uploadMediaFile(m.url, m.name);
      if (up) done.push(up); else failed.push(m.name);
    }
    setFiles((prev) => [...prev, ...done].slice(0, MAX_THREAD_ATTACHMENTS));
    if (failed.length) setError(`Not attached (photo, video or PDF only, max 10 MB): ${failed.join(", ")}`);
    setUploading(false);
  }, []);

  const remove = useCallback((url: string) => setFiles((prev) => prev.filter((f) => f.url !== url)), []);
  const clear = useCallback(() => { setFiles([]); setError(null); }, []);
  return { files, uploading, error, add, remove, clear, full: files.length >= MAX_THREAD_ATTACHMENTS };
}
export type AttachDraft = ReturnType<typeof useAttachDraft>;

/** Paperclip button + hidden picker for a composer. */
export function AttachButton({ draft, disabled }: { draft: AttachDraft; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" multiple hidden accept="image/*,video/*,application/pdf,.pdf"
        onChange={(e) => { void draft.add(e.target.files); e.target.value = ""; }} />
      <Button size="sm" variant="ghost" disabled={disabled || draft.uploading || draft.full}
        onClick={() => ref.current?.click()} title="Attach photo, video or PDF">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path d="M21.4 11.1l-9.2 9.2a6 6 0 01-8.5-8.5l9.2-9.2a4 4 0 015.7 5.7l-9.2 9.2a2 2 0 01-2.8-2.8l8.5-8.5" />
        </svg>
        {draft.uploading ? "Uploading…" : "Attach"}
      </Button>
    </>
  );
}

const ICON: Record<ThreadAttachment["type"], string> = { image: "🖼", video: "🎬", pdf: "📄" };

/** Attachment tiles. With `onRemove` = composer draft; without = sent message. */
export function AttachmentList({ files, onRemove }: { files: ThreadAttachment[]; onRemove?: (url: string) => void }) {
  if (!files.length) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-2">
      {files.map((f) => (
        <li key={f.url} className="relative">
          <a href={f.url} target="_blank" rel="noreferrer" title={f.name}
            className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-card)] bg-[var(--bg-card)] text-caption text-[var(--text-secondary)] no-underline">
            {f.type === "image"
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={f.url} alt={f.name} className="h-full w-full object-cover" loading="lazy" />
              : <span className="flex flex-col items-center gap-0.5 px-1 text-center"><span aria-hidden>{ICON[f.type]}</span><span className="line-clamp-1 max-w-[56px] break-all">{f.name}</span></span>}
          </a>
          {onRemove && (
            <button type="button" onClick={() => onRemove(f.url)} aria-label={`Remove ${f.name}`}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-[var(--border-card)] bg-[var(--bg-card)] text-caption leading-none text-[var(--text-secondary)]">
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
