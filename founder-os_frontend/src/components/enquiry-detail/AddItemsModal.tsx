import React, { useRef, useState } from "react";
import type { Enquiry, EnquiryItem } from "../../types";
import { Button, Modal } from "../ui";
import ItemBoxList, { blankItem } from "../ItemBoxList";
import type { EnquiryDetailProps } from "./types";

// "Add items" modal for one enquiry (extracted from EnquiryDetail). Two
// paths: AI bulk (text + photos → server-side append, intake splits it) or
// structured item boxes (updater-form append to the LATEST items). Mounted
// only while open, so closing always resets the drafts.
export default function AddItemsModal({ enquiry, onUpdateItems, onAddRequirement, onClose }: {
  enquiry: Enquiry;
  onUpdateItems?: EnquiryDetailProps["onUpdateItems"];
  onAddRequirement?: EnquiryDetailProps["onAddRequirement"];
  onClose: () => void;
}) {
  const [newItems, setNewItems] = useState<EnquiryItem[]>([blankItem()]);
  // Structured-add in flight: disables the button so a slow save can never
  // be double-submitted into duplicate items.
  const [savingItems, setSavingItems] = useState(false);
  const [addReqText, setAddReqText] = useState("");
  const [addReqImages, setAddReqImages] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [savingReq, setSavingReq] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Single-flight: while an aiPending row is unprocessed the split is still
  // working — a second add would split into duplicate lines (backend 409s too).
  const aiSplitActive = (enquiry.items ?? []).some((it) => (it as any)?.aiPending === true);

  const saveStructured = () => {
    const fresh = newItems.filter((it) => it.name.trim() || it.qty.trim() || it.spec.trim() || (it.media ?? []).length > 0);
    if (fresh.length === 0 || !onUpdateItems || savingItems) return;
    // Updater form: appends to the LATEST items at execution time. Closes
    // only on success; failure keeps the boxes with the saveError banner.
    setSavingItems(true);
    Promise.resolve(onUpdateItems(enquiry.id, (prev) => [...(prev ?? []), ...fresh]))
      .then(onClose)
      .catch(() => { /* saveError banner carries the message; boxes are kept */ })
      .finally(() => setSavingItems(false));
  };

  const addImages = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const { media } = await import("../../lib/imageFiles").then((m) => m.filesToUploadedMedia(Array.from(files)));
    const urls = media.filter((m) => m.type === "image").map((m) => m.url);
    if (urls.length > 0) setAddReqImages((prev) => [...prev, ...urls]);
  };

  // "Add via AI": prefers the server-side append endpoint (reads FRESH stored
  // items, appends ONE raw aiPending row, kicks intake). The full-array echo
  // via onUpdateItems is fallback only (stale echo once wiped AI-split lines).
  const saveAi = () => {
    const text = addReqText.trim();
    if ((!text && addReqImages.length === 0) || savingReq || aiSplitActive) return;
    const done = () => { setSavingReq(false); onClose(); };
    if (onAddRequirement) {
      setSavingReq(true);
      Promise.resolve(onAddRequirement(enquiry.id, text, addReqImages.length > 0 ? addReqImages : undefined))
        .then(done)
        .catch(() => setSavingReq(false));
    } else if (onUpdateItems) {
      const newItem: EnquiryItem = { name: "", qty: "", spec: text.slice(0, 2000), media: addReqImages.map((url) => ({ type: "image" as const, url })), aiPending: true };
      setSavingReq(true);
      Promise.resolve(onUpdateItems(enquiry.id, (prev) => [...(prev ?? []), newItem]))
        .then(done)
        .catch(() => setSavingReq(false));
    }
  };

  const hasFiles = (e: React.DragEvent) => (e.dataTransfer.types || []).includes("Files");

  return (
    <Modal title="Add items" subtitle="New items join the vendor-rate flow as rate-pending" onClose={onClose}>
      <div
        className={`space-y-3 rounded-[var(--radius-control)] border p-4 transition-colors ${dragOver ? "border-[var(--color-brand-indigo)] bg-[color-mix(in_srgb,var(--color-brand-indigo)_8%,transparent)]" : "border-[var(--border-card)] bg-[var(--surface-sunken)]"}`}
        onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setDragOver(false); void addImages(e.dataTransfer.files); }}
      >
        <div>
          <p className="text-label font-semibold text-[var(--text-primary)]">Describe with AI</p>
          <p className="text-caption text-[var(--text-secondary)]">Type or paste anything and attach photos — AI splits items, attaches drawings and checks past prices (~1 min).</p>
        </div>
        <textarea
          value={addReqText}
          onChange={(e) => setAddReqText(e.target.value)}
          rows={5}
          placeholder={"e.g. Rajdhani Flour Mill — 24GG Milling Fabric 136cm 50 mtr + extra roller 2 nos…"}
          className="min-h-[110px] w-full resize-y rounded-[var(--radius-sm)] border border-[var(--border-card)] bg-[var(--bg-card)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-brand-indigo)]"
        />
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void addImages(e.target.files); e.target.value = ""; }} />
        {addReqImages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {addReqImages.map((url, i) => (
              <div key={i} className="relative h-16 w-16 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-card)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Attachment ${i + 1}`} className="h-full w-full object-cover" />
                <button type="button" aria-label="Remove photo" onClick={() => setAddReqImages((prev) => prev.filter((_, j) => j !== i))} className="absolute right-0.5 top-0.5 h-5 w-5 cursor-pointer rounded-full border-0 bg-black/60 text-[11px] text-white">×</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>+ Attach photos <span className="hidden font-normal text-[var(--text-tertiary)] sm:inline">or drop here</span></Button>
          <Button size="sm" variant="primary" disabled={(!addReqText.trim() && addReqImages.length === 0) || aiSplitActive || savingReq} onClick={saveAi}>
            {savingReq ? "Adding…" : aiSplitActive ? "Splitting…" : "Add via AI"}
          </Button>
        </div>
        {aiSplitActive && (
          <p className="text-caption text-[var(--color-warning)]">AI is still splitting the previous requirement — wait for it to finish (a second add would duplicate every line).</p>
        )}
      </div>

      <div className="my-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--border-card)]" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">or enter items manually</span>
        <span className="h-px flex-1 bg-[var(--border-card)]" />
      </div>

      <ItemBoxList items={newItems} onChange={setNewItems} />
      <div className="flex justify-end gap-2 pt-4">
        <Button size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={saveStructured} disabled={savingItems}>{savingItems ? "Saving…" : "Add items"}</Button>
      </div>
    </Modal>
  );
}
