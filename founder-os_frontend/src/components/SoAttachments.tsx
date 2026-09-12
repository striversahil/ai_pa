"use client";

import React, { useState } from "react";
import Lightbox from "@/components/Lightbox";

export type SoAttachmentKind = "invoice" | "lr" | "pod" | "other";

export interface SoAttachment {
  id: string;
  kind: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
  url: string;
}

const KIND_LABEL: Record<string, string> = {
  invoice: "🧾 Invoice",
  lr: "🚚 LR copy",
  pod: "📦 POD",
  other: "📎 Doc",
};

const fmtSize = (n: number): string => {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const isImage = (a: SoAttachment): boolean =>
  a.mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(a.fileName);
const isPdf = (a: SoAttachment): boolean =>
  a.mime === "application/pdf" || /\.pdf$/i.test(a.fileName);

/** SO documents (invoice PDFs, LR copies, PODs) inside the order's expanded
 *  row. Images open in the native Lightbox, PDFs in the fullscreen iframe
 *  viewer — same big-view components as team chat. Upload/delete is MIS-only
 *  (accounts desk works under the MIS grant); everyone else reads. */
export default function SoAttachments({
  so,
  attachments,
  canManage,
  onChanged,
}: {
  so: string;
  attachments: SoAttachment[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null);
  const [kind, setKind] = useState<SoAttachmentKind>("invoice");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = Array.isArray(attachments) ? attachments : [];
  const images = list.filter(isImage);

  const openAttachment = (a: SoAttachment) => {
    if (isImage(a)) {
      const urls = (images.length > 0 ? images : [a]).map((x) => x.url);
      setLightbox({ images: urls, index: Math.max(0, urls.indexOf(a.url)) });
    } else if (isPdf(a)) {
      setViewer({ url: a.url, name: a.fileName });
    } else {
      window.open(a.url, "_blank", "noopener");
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (file.size > 20 * 1024 * 1024) {
      setError(`"${file.name}" exceeds 20MB.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("soNumber", so);
      fd.append("kind", kind);
      fd.append("file", file);
      const res = await fetch("/api/crm/attachments", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Upload failed — please retry.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/crm/attachments/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Delete failed — please retry.");
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-zinc-200/70 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">
          📎 Documents ({list.length})
        </span>
        {canManage && (
          <label className="flex items-center gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as SoAttachmentKind)}
              className="px-1.5 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300"
            >
              <option value="invoice">🧾 Invoice</option>
              <option value="lr">🚚 LR copy</option>
              <option value="pod">📦 POD</option>
              <option value="other">📎 Other</option>
            </select>
            <span className={`cursor-pointer rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${busy ? "bg-zinc-200 text-zinc-400 dark:bg-zinc-800" : "bg-brand-indigo/10 text-brand-indigo hover:bg-brand-indigo/20"}`}>
              {busy ? "Uploading…" : "+ Attach"}
            </span>
            <input
              type="file"
              accept="application/pdf,image/*,.pdf"
              className="hidden"
              disabled={busy}
              onChange={(e) => { void upload(e.target.files); e.target.value = ""; }}
            />
          </label>
        )}
      </div>

      {list.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic">
          No documents yet{canManage ? " — attach the invoice PDF, LR copy or POD here." : "."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {list.map((a) => (
            <div
              key={a.id}
              className="group relative overflow-hidden rounded-lg border border-zinc-200/70 dark:border-zinc-800 bg-white dark:bg-zinc-900"
            >
              {isImage(a) ? (
                <img
                  src={a.url}
                  alt={a.fileName}
                  loading="lazy"
                  onClick={() => openAttachment(a)}
                  className="h-24 w-full cursor-zoom-in object-cover"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => openAttachment(a)}
                  className="flex h-24 w-full cursor-pointer flex-col items-center justify-center gap-1 border-0 bg-red-500/5 hover:bg-red-500/10"
                >
                  <span className="text-2xl">{isPdf(a) ? "📕" : "📄"}</span>
                  <span className="px-1.5 text-center text-[10px] font-bold text-zinc-600 dark:text-zinc-300 truncate w-full">
                    {a.fileName}
                  </span>
                </button>
              )}
              <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                <span className="truncate text-[10px] font-bold text-zinc-500">
                  {KIND_LABEL[a.kind] || KIND_LABEL.other}
                  {a.uploadedBy ? ` · ${a.uploadedBy}` : ""}
                  {fmtSize(a.size) ? ` · ${fmtSize(a.size)}` : ""}
                </span>
                {canManage && (
                  <button
                    type="button"
                    title={`Delete ${a.fileName}`}
                    onClick={() => void remove(a.id, a.fileName)}
                    className="flex-shrink-0 cursor-pointer rounded border-0 bg-transparent px-1 text-[11px] text-zinc-400 hover:text-red-500"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-[11px] font-bold text-red-500">{error}</p>}

      {lightbox && (
        <Lightbox
          images={lightbox.images}
          initialIndex={lightbox.index}
          image={null}
          onClose={() => setLightbox(null)}
        />
      )}

      {viewer && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
          onClick={() => setViewer(null)}
        >
          <button
            className="absolute top-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white transition-colors hover:text-zinc-400"
            onClick={() => setViewer(null)}
            type="button"
            title="Close"
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
              src={viewer.url}
              title={viewer.name}
              className="h-[85vh] w-[90vw] rounded-lg border border-white/10 bg-white"
            />
            <span className="rounded-full bg-black/50 px-3 py-1 text-xs font-semibold text-white">
              {viewer.name}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
