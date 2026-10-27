"use client";

import React, { useState } from "react";
import Modal from "../Modal";
import {
  HIRING_DOC_LABEL,
  type HiringDocKind,
  type HrHiringPosition,
} from "@/hr/types";
import { uploadPositionDoc } from "@/hr/api";

const MAX_BYTES = 20 * 1024 * 1024;

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function sizeLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Adds one JD/SOP PDF. A position can hold as many as HR uploads. */
export default function PositionDocUploadModal({
  position,
  kind,
  onClose,
  onUploaded,
}: {
  position: HrHiringPosition;
  kind: HiringDocKind;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const label = HIRING_DOC_LABEL[kind];
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next = files[0];
    if (!isPdf(next)) { setErr("Only PDF files are accepted."); return; }
    if (next.size > MAX_BYTES) { setErr(`"${next.name}" is larger than 20MB.`); return; }
    if (next.size <= 0) { setErr("That file is empty."); return; }
    setErr(null);
    setFile(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setErr("Choose a PDF first."); return; }
    setBusy(true);
    setErr(null);
    try {
      await uploadPositionDoc(position.id, kind, file, title);
      onUploaded();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Upload failed — please retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Add ${label.toLowerCase()}`}
      subtitle={position.name}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Title (optional)</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder={kind === "jd" ? "e.g. Sales Executive JD (2026)" : "e.g. Attendance & leave SOP"}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <p className="mt-1 text-[11px] text-zinc-500">Defaults to the file name.</p>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">PDF file</label>
          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files); }}
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-6 text-xs font-bold transition-colors ${
              dragOver
                ? "border-indigo-500 bg-indigo-500/10 text-indigo-500"
                : "border-zinc-300 text-zinc-500 hover:border-indigo-500 hover:text-indigo-500 dark:border-zinc-700"
            }`}
          >
            {file ? (
              <span className="min-w-0 text-center">
                <span className="block truncate">📕 {file.name}</span>
                <span className="mt-0.5 block text-[11px] font-medium text-zinc-500">{sizeLabel(file.size)} · click to change</span>
              </span>
            ) : (
              <>
                <span className="text-sm">＋</span>
                Drop a PDF here or click to choose (max 20MB)
              </>
            )}
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              disabled={busy}
              onChange={(e) => { pick(e.target.files); e.target.value = ""; }}
            />
          </label>
        </div>

        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-semibold text-rose-500">{err}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !file}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? "Uploading…" : `Upload ${label}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
