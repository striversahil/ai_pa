"use client";

import React, { useState } from "react";
import ConfirmDialog from "../ui/ConfirmDialog";
import PositionDocUploadModal from "./PositionDocUploadModal";
import {
  HIRING_DOC_LABEL,
  type HiringDocKind,
  type HrHiringPosition,
  type HrPositionDoc,
} from "@/hr/types";
import { docsFor } from "@/hr/hiring-positions";
import { deletePositionDoc } from "@/hr/api";
import { shortDate } from "@/hr/format";

function sizeLabel(n: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * JD or SOP group for one position. A role can hold any number of documents
 * of each kind, so this renders a list plus an "Add" action.
 */
export default function PositionDocSlot({
  position,
  kind,
  canManage,
  onView,
  onChanged,
}: {
  position: HrHiringPosition;
  kind: HiringDocKind;
  canManage: boolean;
  onView: (doc: HrPositionDoc) => void;
  onChanged: () => void;
}) {
  const docs = docsFor(position, kind);
  const label = HIRING_DOC_LABEL[kind];
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState<HrPositionDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await deletePositionDoc(deleting.id);
      setDeleting(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed — please retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">{label}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${docs.length > 0 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
          {docs.length > 0 ? `${docs.length} file${docs.length === 1 ? "" : "s"}` : "None"}
        </span>
      </div>

      {docs.length > 0 ? (
        <ul className="space-y-1.5">
          {docs.map((doc) => (
            <li key={doc.id} className="rounded-lg border border-zinc-200/70 px-2.5 py-2 dark:border-zinc-800">
              <div className="flex items-start gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-base">📕</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-bold text-zinc-800 dark:text-zinc-100" title={doc.title || doc.fileName}>
                    {doc.title || doc.fileName}
                  </div>
                  <div className="truncate text-[10px] text-zinc-500" title={doc.fileName}>{doc.fileName}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-zinc-500">
                    {sizeLabel(doc.size) && <span>{sizeLabel(doc.size)}</span>}
                    {doc.uploadedBy && <span>by {doc.uploadedBy}</span>}
                    {doc.createdAt && <span>{shortDate(doc.createdAt)}</span>}
                  </div>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onView(doc)}
                  className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-500"
                >
                  View
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setDeleting(doc)}
                    className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10"
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-300 px-3 py-4 text-center text-[11px] text-zinc-500 dark:border-zinc-700">
          {canManage ? `No ${label.toLowerCase()} yet.` : "Not uploaded yet."}
        </div>
      )}

      {canManage && (
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="mt-2 w-full rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-[11px] font-bold text-zinc-500 hover:border-indigo-500 hover:text-indigo-500 dark:border-zinc-700"
        >
          ＋ Add {label.toLowerCase()}
        </button>
      )}

      {error && <p className="mt-2 text-[11px] font-bold text-rose-500">{error}</p>}

      {uploadOpen && (
        <PositionDocUploadModal
          position={position}
          kind={kind}
          onClose={() => setUploadOpen(false)}
          onUploaded={onChanged}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title={`Remove ${label.toLowerCase()}?`}
        message={<>Delete <b>{deleting?.title || deleting?.fileName}</b> from <b>{position.name}</b>? The PDF is removed from storage.</>}
        confirmLabel="Remove"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
