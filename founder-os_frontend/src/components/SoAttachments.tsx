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

/** Invoices live in the Accounts tab only — every other tab (CRM Desk,
 *  Dispatch, SO Materials, Overview) sees operational docs (LR / POD / other).
 *  Central rule so collapsed-row 📎 badges and expanded lists never disagree. */
export function visibleSoAttachments(order: any, tab: string): SoAttachment[] {
  const list: SoAttachment[] = Array.isArray(order?.attachments) ? order.attachments : [];
  if (tab === "accounts") return list;
  return list.filter((a) => a.kind !== "invoice");
}

const KIND_META: Record<string, { label: string; chip: string }> = {
  invoice: { label: "Invoice", chip: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30" },
  lr: { label: "LR copy", chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30" },
  pod: { label: "POD", chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
  other: { label: "Doc", chip: "bg-zinc-500/10 text-zinc-500 border-zinc-500/30" },
};

const fmtSize = (n: number): string => {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const fmtDate = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const isImage = (a: SoAttachment): boolean =>
  a.mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(a.fileName);
const isPdf = (a: SoAttachment): boolean =>
  a.mime === "application/pdf" || /\.pdf$/i.test(a.fileName);

/** SO documents inside the order's expanded row. Images open in the native
 *  Lightbox, PDFs in the fullscreen iframe viewer — same big-view components
 *  as team chat. Upload/delete is MIS-only (accounts desk works under the MIS
 *  grant); everyone else reads. */
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
  const [dragOver, setDragOver] = useState(false);
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
    if (!files || files.length === 0 || busy) return;
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
      setDragOver(false);
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
    <div className="mt-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">
          Documents
        </span>
        <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-[10px] font-extrabold text-zinc-500">
          {list.length}
        </span>
      </div>

      {list.length > 0 && (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60 overflow-hidden rounded-xl border border-zinc-200/70 dark:border-zinc-800 bg-white dark:bg-zinc-900/60">
          {list.map((a) => {
            const meta = KIND_META[a.kind] || KIND_META.other;
            return (
              <li
                key={a.id}
                onClick={() => openAttachment(a)}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                {isImage(a) ? (
                  <img
                    src={a.url}
                    alt={a.fileName}
                    loading="lazy"
                    className="h-11 w-11 flex-shrink-0 rounded-lg border border-zinc-200/70 dark:border-zinc-700 object-cover"
                  />
                ) : (
                  <span
                    className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-xl ${
                      isPdf(a) ? "bg-red-500/10" : "bg-zinc-500/10"
                    }`}
                  >
                    {isPdf(a) ? "📕" : "📄"}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    {a.fileName}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
                    <span className={`rounded-full border px-1.5 py-px font-extrabold ${meta.chip}`}>
                      {meta.label}
                    </span>
                    {fmtSize(a.size) && <span>{fmtSize(a.size)}</span>}
                    {a.uploadedBy && <span>by {a.uploadedBy}</span>}
                    {fmtDate(a.createdAt) && <span>{fmtDate(a.createdAt)}</span>}
                  </span>
                </span>
                <span className="flex-shrink-0 text-[11px] font-bold text-brand-indigo">
                  {isImage(a) ? "View" : isPdf(a) ? "Open" : "Download"} →
                </span>
                {canManage && (
                  <button
                    type="button"
                    title={`Delete ${a.fileName}`}
                    onClick={(e) => { e.stopPropagation(); void remove(a.id, a.fileName); }}
                    className="flex-shrink-0 cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 text-xs text-zinc-300 hover:bg-red-500/10 hover:text-red-500 dark:text-zinc-600"
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && (
        <div className="mt-2 flex items-stretch gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as SoAttachmentKind)}
            className="flex-shrink-0 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-[11px] font-bold text-zinc-600 dark:text-zinc-300"
            aria-label="Document kind"
          >
            <option value="invoice">🧾 Invoice</option>
            <option value="lr">🚚 LR copy</option>
            <option value="pod">📦 POD</option>
            <option value="other">📎 Other</option>
          </select>
          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); void upload(e.dataTransfer.files); }}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-[11px] font-bold transition-colors ${
              dragOver
                ? "border-brand-indigo bg-brand-indigo/10 text-brand-indigo"
                : "border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:border-brand-indigo hover:text-brand-indigo"
            } ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            <span className="text-sm">{busy ? "⏳" : "＋"}</span>
            {busy ? "Uploading…" : "Drop file here or click to attach (PDF / photo, 20MB max)"}
            <input
              type="file"
              accept="application/pdf,image/*,.pdf"
              className="hidden"
              disabled={busy}
              onChange={(e) => { void upload(e.target.files); e.target.value = ""; }}
            />
          </label>
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
