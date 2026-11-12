"use client";

// Extracted verbatim from OrderPanel.tsx by scripts/refactor/split-module.mjs.
// OrderPanel.tsx re-exports everything public here, so existing imports keep working.
import type { CrmDispatchProof, CrmProofFile } from "../types";
import { useState } from "react";
import { crmApi } from "../api";
import { CheckCircle2 } from "lucide-react";
import { uploadProofFile, proofFileFromId, isPhotoFile, isPdfFile } from "./helpers";

/** One dispatch batch: invoice + packing photos with View/Download, batch
 *  quantities, and Pending slots the floor can fill afterwards. The pending
 *  state lives inside this proof card — never on the lifecycle chips. */
export function ProofCard({
  orderId,
  soNumber,
  proof,
  canWrite,
  onOpenDoc,
  onChanged,
}: {
  orderId: string;
  soNumber: string;
  proof: CrmDispatchProof;
  canWrite: boolean;
  /** Opens a document in the shared big view (Lightbox / PdfViewer). */
  onOpenDoc: (file: CrmProofFile) => void;
  onChanged: () => void;
}) {
  /** The five optional documents — each attaches after the dispatch too.
   *  Packing photos stay photo-only; the three receipts/docs take photo or PDF. */
  type AttachSlot = "beforeId" | "afterId" | "transportId" | "courierId" | "packingListId";
  const ATTACH_META: Record<AttachSlot, { label: string; kind: string; photoOnly: boolean; accept: string; cta: string }> = {
    beforeId: { label: "Before packing", kind: "packing_before", photoOnly: true, accept: "image/*", cta: "Add photo" },
    afterId: { label: "After packing", kind: "packing_after", photoOnly: true, accept: "image/*", cta: "Add photo" },
    transportId: { label: "Transport receipt", kind: "transport_receipt", photoOnly: false, accept: "application/pdf,image/*,.pdf", cta: "Add document" },
    courierId: { label: "Courier receipt", kind: "courier_receipt", photoOnly: false, accept: "application/pdf,image/*,.pdf", cta: "Add document" },
    packingListId: { label: "Packing list", kind: "packing_list", photoOnly: false, accept: "application/pdf,image/*,.pdf", cta: "Add document" },
  };
  const [busy, setBusy] = useState<AttachSlot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addDoc = async (slot: AttachSlot, file: File | null) => {
    if (!file || busy) return;
    const meta = ATTACH_META[slot];
    const isPhoto = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (meta.photoOnly && !isPhoto) {
      setError(`${meta.label} must be a photo.`);
      return;
    }
    if (!meta.photoOnly && !isPhoto && !isPdf) {
      setError(`${meta.label} must be a photo or a PDF.`);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError(`"${file.name}" exceeds 20MB.`);
      return;
    }
    setBusy(slot);
    setError(null);
    try {
      const id = await uploadProofFile(soNumber, meta.kind, file);
      const payload: Partial<Record<AttachSlot, string>> = { [slot]: id };
      await crmApi.attachProofDocs(orderId, proof.id, payload);
      onChanged();
    } catch (e: any) {
      setError(e?.message || `Could not attach the ${meta.label.toLowerCase()} — please retry.`);
    } finally {
      setBusy(null);
    }
  };

  /** One proof document: thumbnail on the left (opens the big view), name,
   *  and explicit View / Download actions. An empty optional slot shows a
   *  muted dash; an empty packing photo offers the add-later upload. */
  const renderDoc = (
    label: string,
    slot: "invoice" | "before" | "after" | "transport" | "courier" | "packingList",
    canAdd?: AttachSlot,
  ) => {
    const found = proof.files?.[slot];
    const fallbackId =
      slot === "invoice" ? proof.invoiceId
      : slot === "before" ? proof.beforeId
      : slot === "after" ? proof.afterId
      : slot === "transport" ? proof.transportId
      : slot === "courier" ? proof.courierId
      : proof.packingListId;
    const file = found?.url ? found : fallbackId ? proofFileFromId(fallbackId) : null;
    const photo = isPhotoFile(file);
    return (
      <div className="flex items-center gap-2 py-1">
        {file ? (
          photo ? (
            <button
              type="button"
              onClick={() => onOpenDoc(file)}
              title={`Open ${label}`}
              className="h-9 w-9 shrink-0 cursor-zoom-in overflow-hidden rounded-md border border-zinc-200 p-0 dark:border-zinc-700"
            >
              <img src={file.url} alt={file.fileName || label} loading="lazy" className="h-full w-full object-cover" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenDoc(file)}
              title={`Open ${label}`}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-sm ${
                isPdfFile(file) ? "border-red-500/30 bg-red-500/10" : "border-zinc-200 bg-zinc-500/10 dark:border-zinc-700"
              }`}
            >
              {isPdfFile(file) ? "📕" : "📄"}
            </button>
          )
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-dashed border-zinc-300 text-[11px] text-zinc-400 dark:border-zinc-700">
            —
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-zinc-700 dark:text-zinc-200">{label}</span>
          {file?.fileName ? (
            <span className="block truncate text-[10px] text-zinc-400">{file.fileName}</span>
          ) : null}
        </span>
        {file ? (
          <span className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => onOpenDoc(file)}
              className="border-0 bg-transparent p-0 font-bold text-indigo-600 hover:underline dark:text-indigo-400"
            >
              View
            </button>
            <a
              href={`${file.url}?download=1`}
              className="font-bold text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Download
            </a>
          </span>
        ) : canAdd ? (
          <span className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
              Pending
            </span>
            {canWrite && (
              <label className={`cursor-pointer font-bold text-indigo-600 hover:underline dark:text-indigo-400 ${busy ? "pointer-events-none opacity-60" : ""}`}>
                {busy === canAdd ? "Uploading…" : ATTACH_META[canAdd].cta}
                <input
                  type="file"
                  accept={ATTACH_META[canAdd].accept}
                  className="hidden"
                  disabled={!!busy}
                  onChange={(e) => { void addDoc(canAdd, e.target.files?.[0] ?? null); e.target.value = ""; }}
                />
              </label>
            )}
          </span>
        ) : (
          <span className="shrink-0 text-[10px] text-zinc-400">—</span>
        )}
      </div>
    );
  };

  return (
    <li className="rounded-xl border border-zinc-200 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
      <div className="flex items-center gap-1.5">
        <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
        <span>
          <b>{proof.day || "dispatch"}</b>
          {proof.actor ? ` · ${proof.actor}` : ""}
        </span>
      </div>
      {proof.items && proof.items.length > 0 && (
        <div className="mt-1 rounded-lg bg-emerald-500/5 px-2 py-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Items dispatched</p>
          <ul className="mt-0.5 space-y-0.5">
            {proof.items.map((bi) => (
              <li key={`${proof.id}-${bi.itemId}`} className="tabular-nums">
                <b>{bi.qty}{bi.unit ? ` ${bi.unit}` : ""}</b> × {bi.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-1 divide-y divide-zinc-100 dark:divide-zinc-800/60">
        {renderDoc("Invoice", "invoice")}
        {renderDoc("Before packing", "before", "beforeId")}
        {renderDoc("After packing", "after", "afterId")}
        {renderDoc("Transport receipt", "transport", "transportId")}
        {renderDoc("Courier receipt", "courier", "courierId")}
        {renderDoc("Packing list", "packingList", "packingListId")}
      </div>
      {proof.items && proof.items.length > 0 && (
        <ul className="mt-1 space-y-0.5 border-t border-zinc-100 pl-5 pt-1 dark:border-zinc-800/60">
          {proof.items.map((bi) => (
            <li key={`${proof.id}-${bi.itemId}`} className="tabular-nums">
              {bi.qty}{bi.unit ? ` ${bi.unit}` : ""} × {bi.name}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 font-bold text-rose-500">{error}</p>}
    </li>
  );
}
