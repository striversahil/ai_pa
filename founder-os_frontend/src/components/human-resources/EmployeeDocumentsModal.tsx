"use client";

import React, { useEffect, useRef, useState } from "react";
import Modal from "../Modal";
import type { HrEmployee } from "@/hr/types";
import { deleteMemberDocument, fetchMemberDocuments, uploadMemberDocument } from "@/hr/api";
import type { MemberDocument, MemberDocumentsPayload } from "@/hr/member-documents";

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return Math.max(1, Math.round(bytes / 1024)) + " KB";
}

export default function EmployeeDocumentsModal({ employee, onClose }: { employee: HrEmployee; onClose: () => void }) {
  const [data, setData] = useState<MemberDocumentsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [uploadType, setUploadType] = useState<string | null>(null);
  const [preview, setPreview] = useState<MemberDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    setErr(null);
    try {
      setData(await fetchMemberDocuments(employee.id));
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load documents"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [employee.id]);

  const chooseFile = (typeId: string) => {
    setUploadType(typeId);
    if (fileRef.current) fileRef.current.value = "";
    fileRef.current?.click();
  };

  const upload = async (file: File) => {
    if (!uploadType) return;
    setBusy(true); setErr(null);
    try {
      await uploadMemberDocument(employee.id, uploadType, file);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(false); setUploadType(null); }
  };

  const remove = async (doc: MemberDocument) => {
    if (!confirm('Delete "' + (doc.title || doc.fileName) + '"?')) return;
    setBusy(true); setErr(null);
    try {
      await deleteMemberDocument(doc.id);
      if (preview?.id === doc.id) setPreview(null);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Delete failed"); }
    finally { setBusy(false); }
  };

  const pct = data && data.completeness.required > 0
    ? Math.round((data.completeness.uploaded / data.completeness.required) * 100) : 100;

  return (
    <Modal
      title={"Documents · " + (employee.displayName || employee.name)}
      subtitle="HR-defined checklist. PDF, JPEG, PNG or WebP up to 20 MB each."
      onClose={onClose}
      wide
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
      />

      {err && <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-semibold text-rose-500">{err}</div>}
      {loading && <div className="py-10 text-center text-sm text-zinc-500 animate-pulse">Loading documents…</div>}

      {data && (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold">Required documents</span>
              <span className="font-extrabold">{data.completeness.uploaded} / {data.completeness.required}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div className={"h-full rounded-full " + (pct === 100 ? "bg-emerald-500" : "bg-amber-500")} style={{ width: pct + "%" }} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {data.documentTypes.map((type) => (
              <section key={type.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h4 className="text-xs font-bold">{type.name}</h4>
                      {type.required && type.active && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-amber-600">Required</span>}
                      {!type.active && <span className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-zinc-500">Archived</span>}
                    </div>
                    {type.description && <p className="mt-0.5 text-[10px] text-zinc-500">{type.description}</p>}
                  </div>
                  {type.active && <button disabled={busy} onClick={() => chooseFile(type.id)}
                    className="shrink-0 rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-indigo-500 disabled:opacity-50">Upload</button>}
                </div>
                <div className="mt-2 space-y-1">
                  {type.documents.length === 0 ? (
                    <p className={"rounded border border-dashed px-2 py-3 text-center text-[10px] " + (type.required ? "border-amber-500/40 text-amber-600" : "border-zinc-200 text-zinc-400 dark:border-zinc-800")}>
                      {type.required ? "Required — not uploaded yet" : "Not uploaded"}
                    </p>
                  ) : type.documents.map((doc) => (
                    <div key={doc.id} className="flex items-center gap-1.5 rounded-lg border border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
                      <button onClick={() => setPreview(doc)} className="min-w-0 flex-1 text-left">
                        <div className="truncate text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400">{doc.title || doc.fileName}</div>
                        <div className="text-[9px] text-zinc-500">{sizeLabel(doc.size)} · {doc.uploadedBy || "HR"}</div>
                      </button>
                      <button onClick={() => setPreview(doc)} className="rounded px-1 py-0.5 text-[10px] font-bold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">View</button>
                      <button disabled={busy} onClick={() => remove(doc)} className="rounded px-1 py-0.5 text-[10px] font-bold text-rose-500 hover:bg-rose-500/10">Delete</button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {preview && (
            <div className="rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-xs font-bold">{preview.title || preview.fileName}</span>
                <button onClick={() => setPreview(null)} className="rounded px-2 py-0.5 text-[10px] font-bold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Close preview</button>
              </div>
              {preview.mime.startsWith("image/") ? (
                <img src={preview.url} alt={preview.title || preview.fileName} className="max-h-[420px] w-full rounded-lg object-contain" />
              ) : (
                <iframe src={preview.url} title={preview.title || preview.fileName} className="h-[420px] w-full rounded-lg border-0 bg-white" />
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
