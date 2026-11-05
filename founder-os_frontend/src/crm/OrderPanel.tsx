"use client";

// OrderPanel.tsx — the dispatch floor's single work surface (slide-over).
//
// One panel, four modes:
//   schedule   — tick items, give each a tentative dispatch date; anything you
//                can't date needs a reason (item-level → partially scheduled,
//                or one order-level reason → stays unscheduled)
//   dispatch   — tick scheduled items and send them out (qty defaults to full)
//   reschedule — the committed date slipped: every item needs a new date and
//                the whole move needs a comprehensive reason
//   view       — read-only detail + audit trail
//
// Rendering only: every rule lives in ./lifecycle.ts (mirror of the backend)
// and every transition is executed by the server.
import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Package,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import type { CrmDispatchProof, CrmItem, CrmOrder, CrmProofFile } from "./types";
import { LIFECYCLE_META } from "./types";
import {
  REASON_MIN,
  isDueTodayItem,
  isOverdueItem,
  validateDispatch,
  validateReschedule,
  validateSchedule,
} from "./lifecycle";
import { istToday, useCrmAction } from "./hooks";
import { crmApi } from "./api";
import { REGIONS } from "@/telecalling/regions";
import Lightbox from "@/components/Lightbox";
import PdfViewer from "@/components/PdfViewer";

export type PanelMode = "view" | "schedule" | "dispatch" | "reschedule";

/** Upload one proof file for an SO; resolves the SoAttachment id. Shared by
 *  the dispatch dialog slots and the per-proof add-photo buttons. */
async function uploadProofFile(soNumber: string, kind: string, file: File): Promise<string> {
  const fd = new FormData();
  fd.append("soNumber", soNumber);
  fd.append("kind", kind);
  fd.append("file", file);
  const res = await fetch("/api/crm/attachments", { method: "POST", body: fd });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Upload failed");
  const id = String(data?.attachment?.id || "");
  if (!id) throw new Error("Upload failed — please retry.");
  return id;
}

const inr = (n: number | null | undefined) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/** "26 Oct 2026" — every date in this panel carries its year. The dispatch
 *  window is 30 days wide, so day+month alone reads ambiguous at a glance. */
const dateLabel = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/** "Tue, 26 Oct 2026" — the header's order date gets the weekday too. */
const fullDateLabel = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

/** "R2 · North-Central & Himalayan Belt" — code first, name for humans. */
const regionName = (id: string) =>
  (REGIONS.find((r) => r.id === id)?.name ?? "").replace(/\s*Region$/, "");

/** The little separator between identity facts. */
function Dot() {
  return <span className="text-zinc-300 dark:text-zinc-600">·</span>;
}

/** How old the SO is on the floor: "today", "yesterday", "9 days ago". */
const ageLabel = (d: string | null | undefined, today: string) => {
  const raw = String(d || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !today) return "";
  const a = new Date(`${raw}T00:00:00Z`).getTime();
  const b = new Date(`${today}T00:00:00Z`).getTime();
  if (isNaN(a) || isNaN(b)) return "";
  const days = Math.round((b - a) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days > 1) return `${days} days ago`;
  return `in ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;
};

/** One address block; Zoho keeps billing and shipping separately on the SO.
 *  A floor user with write access can correct either — the edit sets an
 *  edited marker and the Zoho sync leaves that address alone afterwards. */
function AddressCard({ label, value, editedBy, canEdit, onSave, saving }: {
  label: string;
  value?: string | null;
  editedBy?: string | null;
  canEdit: boolean;
  onSave: (text: string) => void;
  saving: boolean;
}) {
  const text = String(value || "").trim();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <div className="rounded-xl border border-zinc-200 px-3.5 py-2.5 dark:border-zinc-800">
      <p className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <span>{label}</span>
        <span className="flex items-center gap-1.5 normal-case">
          {editedBy && <span className="rounded-full bg-amber-500/15 px-1.5 py-px text-[9px] font-bold text-amber-600 dark:text-amber-400" title={`Corrected on the floor by ${editedBy} — the Zoho sync leaves this address alone`}>edited locally</span>}
          {canEdit && !editing && (
            <button onClick={() => { setDraft(text); setEditing(true); }} className="cursor-pointer border-0 bg-transparent p-0 text-[10px] font-bold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400" title="Correct this address">Edit</button>
          )}
        </span>
      </p>
      {editing ? (
        <div className="mt-1.5 space-y-1.5">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} placeholder="Corrected address…" className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950" />
          <div className="flex gap-1.5">
            <button disabled={saving} onClick={() => { onSave(draft.trim()); setEditing(false); }} className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-500 disabled:opacity-50 cursor-pointer border-0">Save</button>
            <button disabled={saving} onClick={() => setEditing(false)} className="rounded-lg border border-zinc-300 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 cursor-pointer">Cancel</button>
          </div>
        </div>
      ) : text ? (
        <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">{text}</p>
      ) : (
        <p className="mt-0.5 text-xs italic text-zinc-400 dark:text-zinc-500">Waiting for the Zoho detail sync…</p>
      )}
    </div>
  );
}

/** One label/value line of the order details — muted label left, value right. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3.5 py-2">
      <dt className="shrink-0 pt-px text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="min-w-0 text-right text-xs text-zinc-700 dark:text-zinc-200">{children}</dd>
    </div>
  );
}

const isPhotoFile = (f: CrmProofFile | null): boolean =>
  !!f && (f.mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.fileName));
const isPdfFile = (f: CrmProofFile | null): boolean =>
  !!f && (f.mime === "application/pdf" || /\.pdf$/i.test(f.fileName));

/** A proof slot that was never uploaded — muted, keeps the row's shape. */
function EmptyProofDoc({ label }: { label: string }) {
  return (
    <div className="flex w-[68px] flex-col items-center gap-1 opacity-45" title={`No ${label.toLowerCase()} attached`}>
      <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-[11px] text-zinc-400 dark:border-zinc-700">
        —
      </span>
      <span className="w-full truncate text-center text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </span>
    </div>
  );
}

/** One document on a consumed proof: photo miniature or PDF tile, both opening
 *  the shared big-view components (Lightbox for images, PdfViewer for PDFs) —
 *  the same UX as the SO documents list and management review. */
function ProofDoc({
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

/** Older payloads carried proof IDs without file metadata — synth a tile so a
 *  dispatched order never shows blank documents. */
const proofFileFromId = (id: string): CrmProofFile => ({
  id,
  kind: "",
  fileName: "",
  mime: "",
  size: 0,
  url: `/api/crm/files/${id}`,
  uploadedBy: "",
  createdAt: null,
});

export default function OrderPanel({
  order,
  initialMode,
  canWrite,
  promiseOnly = false,
  onClose,
  onChanged,
}: {
  order: CrmOrder;
  initialMode: PanelMode;
  canWrite: boolean;
  /** Sales view: dates + delay reasons only. Dispatch/reschedule/address edits
   *  stay with the dispatch floor (`canWrite` alone is not enough). */
  promiseOnly?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const today = istToday();
  const floorWrite = canWrite && !promiseOnly;
  const [mode, setMode] = useState<PanelMode>(initialMode);
  // Full detail (proofs + audit events) lives only on the order-detail
  // endpoint — dashboard list rows carry items but no proofs/events. Fetch it
  // on open; every history section below reads from `detail` first and falls
  // back to the list row while loading.
  const [detail, setDetail] = useState<CrmOrder | null>(null);
  const loadDetail = React.useCallback(() => {
    crmApi
      .order(order.id)
      .then((r) => setDetail(r?.order ?? null))
      .catch(() => {});
  }, [order.id]);
  useEffect(() => {
    setDetail(null);
    loadDetail();
  }, [order.id, loadDetail]);
  const full: CrmOrder = detail ?? order;
  const items = full.items || [];
  const proofs = full.proofs ?? [];
  const events = full.events ?? [];

  const defaultPicked = useMemo(() => {
    if (initialMode === "dispatch") {
      return new Set(
        items
          .filter((it) => it.dispatchState === "scheduled" && (isDueTodayItem(it, today) || isOverdueItem(it, today)))
          .map((it) => it.id),
      );
    }
    if (initialMode === "reschedule") {
      return new Set(items.filter((it) => it.dispatchState === "scheduled" && isOverdueItem(it, today)).map((it) => it.id));
    }
    return new Set(items.filter((it) => it.dispatchState === "unscheduled").map((it) => it.id));
  }, [initialMode, items, today]);

  const [picked, setPicked] = useState<Set<string>>(defaultPicked);
  const [dates, setDates] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const it of items) {
      if (it.tentativeDispatchDate) seed[it.id] = it.tentativeDispatchDate;
    }
    return seed;
  });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [soReason, setSoReason] = useState(order.soDelayReason || "");
  const [moveReason, setMoveReason] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  // Floor address corrections overlay the server row until the parent
  // refreshes (the panel stays open — unlike schedule/dispatch, an address
  // fix is not a mode that ends).
  const [addrOverride, setAddrOverride] = useState<{ billing?: string | null; billingBy?: string | null; shipping?: string | null; shippingBy?: string | null } | null>(null);
  const [addrSaving, setAddrSaving] = useState(false);
  const [addrError, setAddrError] = useState<string | null>(null);

  // ── Dispatch proof (2026-11-04): every Mark dispatched consumes a FRESH
  // invoice PDF; before/after packing photos and the transport receipt, courier
  // receipt and packing list ride along when the floor has them. Files upload
  // the moment they're picked (SoAttachment IDs); the dispatch call sends the
  // IDs and the server burns them. Starts empty on every open so a consumed
  // set can never be re-picked for a repeat partial.
  type ProofSlot = "invoice" | "before" | "after" | "transport" | "courier" | "packingList";
  const PROOF_SLOT_META: Record<ProofSlot, { label: string; kind: string; accept: string; hint: string; photoOnly: boolean }> = {
    invoice: { label: "Invoice PDF", kind: "invoice", accept: "application/pdf,.pdf", hint: "The invoice for this dispatch", photoOnly: false },
    before: { label: "Before packing", kind: "packing_before", accept: "image/*", hint: "Photo before packing", photoOnly: true },
    after: { label: "After packing", kind: "packing_after", accept: "image/*", hint: "Photo after packing", photoOnly: true },
    transport: { label: "Transport receipt", kind: "transport_receipt", accept: "application/pdf,image/*,.pdf", hint: "Transporter's receipt (photo or PDF)", photoOnly: false },
    courier: { label: "Courier receipt", kind: "courier_receipt", accept: "application/pdf,image/*,.pdf", hint: "Courier slip / AWB (photo or PDF)", photoOnly: false },
    packingList: { label: "Packing list", kind: "packing_list", accept: "application/pdf,image/*,.pdf", hint: "Packing list for the box (photo or PDF)", photoOnly: false },

  };
  const PROOF_SLOTS = Object.keys(PROOF_SLOT_META) as ProofSlot[];
  const emptyProofIds = (): { invoiceId: string | null; beforeId: string | null; afterId: string | null; transportId: string | null; courierId: string | null; packingListId: string | null } => ({
    invoiceId: null, beforeId: null, afterId: null, transportId: null, courierId: null, packingListId: null,
  });
  const [proofIds, setProofIds] = useState(emptyProofIds);
  const [proofNames, setProofNames] = useState<Record<ProofSlot, string>>({
    invoice: "", before: "", after: "", transport: "", courier: "", packingList: "",
  });
  const [proofBusy, setProofBusy] = useState<ProofSlot | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  // Big-view state for consumed proof documents (images → Lightbox with
  // prev/next across the order, PDFs → PdfViewer with a download button).
  const [proofLightbox, setProofLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [proofViewer, setProofViewer] = useState<{ url: string; name: string } | null>(null);

  /** Every photo across this order's consumed proofs, in display order — so the
   *  lightbox can page through them instead of opening one at a time. */
  const proofPhotos = useMemo(() => {
    const out: string[] = [];
    for (const p of order.proofs ?? []) {
      const f = p.files;
      for (const k of ["before", "after", "transport", "courier", "packingList"] as const) {
        const file = f?.[k];
        if (file && isPhotoFile(file) && file.url) out.push(file.url);
      }
    }
    return out;
  }, [order.proofs]);

  const openProofDoc = (file: CrmProofFile) => {
    if (isPhotoFile(file)) {
      const list = proofPhotos.includes(file.url) ? proofPhotos : [file.url];
      setProofLightbox({ images: list, index: Math.max(0, list.indexOf(file.url)) });
    } else {
      setProofViewer({ url: file.url, name: file.fileName || "Dispatch document" });
    }
  };

  useEffect(() => {
    setProofIds(emptyProofIds());
    setProofNames({ invoice: "", before: "", after: "", transport: "", courier: "", packingList: "" });
    setProofError(null);
  }, [order.id]);

  const uploadProof = async (slot: ProofSlot, file: File | null) => {
    if (!file || proofBusy) return;
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const isPhoto = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
    if (slot === "invoice" && !isPdf) {
      setProofError("Invoice must be a PDF file.");
      return;
    }
    if (PROOF_SLOT_META[slot].photoOnly && !isPhoto) {
      setProofError("Packing proof must be a photo.");
      return;
    }
    if (!PROOF_SLOT_META[slot].photoOnly && slot !== "invoice" && !isPhoto && !isPdf) {
      setProofError("Attach a photo or a PDF for this document.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setProofError(`"${file.name}" exceeds 20MB.`);
      return;
    }
    setProofBusy(slot);
    setProofError(null);
    try {
      const id = await uploadProofFile(order.soNumber, PROOF_SLOT_META[slot].kind, file);
      setProofIds((p) => ({ ...p, [`${slot}Id`]: id }));
      setProofNames((p) => ({ ...p, [slot]: file.name }));
    } catch (e: any) {
      setProofError(e?.message || "Upload failed — please retry.");
    } finally {
      setProofBusy(null);
    }
  };

  const saveAddress = async (which: "billing" | "shipping", text: string) => {
    setAddrSaving(true);
    setAddrError(null);
    try {
      const res = await crmApi.updateAddresses(order.id, which === "billing" ? { billingAddress: text } : { shippingAddress: text });
      const o = res.order;
      setAddrOverride({
        billing: o.billingAddress, billingBy: o.billingAddressEditedBy,
        shipping: o.shippingAddress, shippingBy: o.shippingAddressEditedBy,
      });
      onChanged();
    } catch (e: any) {
      setAddrError(String(e?.message || e));
    } finally {
      setAddrSaving(false);
    }
  };

  const actions = useCrmAction(() => {
    onChanged();
    onClose();
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A document big-view sits on top of the panel — close it first.
      if (proofLightbox || proofViewer) {
        setProofLightbox(null);
        setProofViewer(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, proofLightbox, proofViewer]);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pickedItems = items.filter((it) => picked.has(it.id));

  // Batches that went out before invoice tracking existed (backfill era):
  // items show dispatched quantities but no proof batch covers them. Shown
  // without an invoice link — quantities come straight from the item rows.
  const untrackedDispatched = useMemo(() => {
    const covered = new Map<string, number>();
    for (const p of proofs) {
      for (const bi of p.items || []) covered.set(bi.itemId, (covered.get(bi.itemId) || 0) + (Number(bi.qty) || 0));
    }
    const out: Array<{ id: string; name: string; qty: number; unit: string }> = [];
    for (const it of items) {
      const missing = (Number(it.dispatchedQty) || 0) - (covered.get(it.id) || 0);
      if (missing > 1e-6) {
        out.push({ id: it.id, name: it.name || it.description || it.sku || "Item", qty: missing, unit: it.unit || "" });
      } else if (it.dispatchState === "dispatched" && !covered.has(it.id)) {
        // Fully dispatched but no recorded quantity — the whole line went out
        // before tracking, so the line quantity is what left the floor.
        out.push({ id: it.id, name: it.name || it.description || it.sku || "Item", qty: Number(it.qty) || 0, unit: it.unit || "" });
      }
    }
    return out;
  }, [items, proofs]);

  // ── Client-side preview of the server's verdict ──────────────────────────
  const check = useMemo(() => {    if (mode === "schedule") {
      return validateSchedule({
        today,
        items,
        entries: pickedItems.map((it) => ({ itemId: it.id, date: dates[it.id] || null, reason: reasons[it.id] || null })),
        soReason,
      });
    }
    if (mode === "dispatch") {
      return validateDispatch({
        items,
        entries: pickedItems.map((it) => ({ itemId: it.id, qty: qty[it.id] ? Number(qty[it.id]) : null })),
        proof: proofIds,
      });
    }
    if (mode === "reschedule") {
      return validateReschedule({
        today,
        items,
        entries: pickedItems.map((it) => ({ itemId: it.id, date: dates[it.id] || null })),
        reason: moveReason,
      });
    }
    return { ok: true as const };
  }, [mode, today, items, pickedItems, dates, reasons, soReason, moveReason, qty, proofIds]);

  const anyDated = pickedItems.some((it) => !!dates[it.id]);

  const submit = async () => {
    if (!check.ok) return;
    if (mode === "schedule") {
      const items = pickedItems.map((it) => ({
        itemId: it.id,
        date: dates[it.id] || null,
        reason: reasons[it.id] || null,
      }));
      if (promiseOnly) await actions.promise(order.id, items, soReason || null);
      else await actions.schedule(order.id, items, soReason || null);
      return;
    }
    if (mode === "dispatch") {
      await actions.dispatch(
        order.id,
        pickedItems.map((it) => ({ itemId: it.id, qty: qty[it.id] ? Number(qty[it.id]) : null })),
        { ...proofIds },
      );
      return;
    }
    if (mode === "reschedule") {
      await actions.reschedule(
        order.id,
        pickedItems.map((it) => ({ itemId: it.id, date: dates[it.id] || "" })),
        moveReason,
      );
    }
  };

  const primary =
    mode === "schedule"
      ? anyDated
        ? promiseOnly
          ? "Confirm dispatch dates"
          : "Schedule selected items"
        : "Record order-level delay"
      : mode === "dispatch"
        ? "Mark dispatched"
        : "Reschedule";

  const meta = LIFECYCLE_META[order.lifecycle];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-3xl flex-col overflow-hidden border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="shrink-0 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 truncate text-base font-semibold tracking-tight">
                  {order.customerName || order.soNumber}
                </h2>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.chip}`}>{meta.label}</span>
                {order.sourceState === "deleted_source" && (
                  <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                    Deleted at source
                  </span>
                )}
              </div>
              {/* Identity line — each fact gets its own space instead of one
                  long dot-separated run-on. */}
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-200">{order.soNumber}</span>
                {order.referenceNumber && (
                  <>
                    <Dot />
                    <span className="font-mono">{order.referenceNumber}</span>
                  </>
                )}
                <Dot />
                <span>{order.region ? `${order.region} · ${regionName(order.region)}` : "Region unmapped"}</span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Mode switch */}
          <nav className="mt-3 flex flex-wrap gap-1.5">
            {(
              [
                ["view", "Items", Package],
                ["schedule", promiseOnly ? "Dispatch dates" : "Schedule", CalendarClock],
                ["dispatch", "Dispatch", Truck],
                ["reschedule", "Reschedule", ArrowRight],
              ] as Array<[PanelMode, string, any]>
            )
              .filter(([key]) => !promiseOnly || key === "view" || key === "schedule")
              .map(([key, label, Icon]) => {
              const disabled =
                key !== "view" &&
                (!canWrite ||
                  order.sourceState === "deleted_source" ||
                  order.lifecycle === "cancelled" ||
                  (key === "dispatch" && !items.some((it) => it.dispatchState === "scheduled")) ||
                  (key === "reschedule" && !items.some((it) => it.dispatchState === "scheduled")) ||
                  (key === "schedule" && !items.some((it) => it.dispatchState === "unscheduled")));
              return (
                <button
                  key={key}
                  disabled={disabled}
                  onClick={() => setMode(key)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    mode === key
                      ? "bg-indigo-600 text-white"
                      : "text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              );
            })}
          </nav>
        </header>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Client & reference — EST no. comes from Zoho's reference_number,
              payment terms are the extracted `terms` Payment line, and the
              addresses come from the per-order detail call (list pages omit
              them, so they fill in as the detail budget reaches this SO).
              Addresses are floor-editable; an edited one shows its marker and
              the Zoho sync leaves it alone afterwards. */}
          {addrError && (
            <div className="mb-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-700 dark:text-rose-300">
              Address save failed: {addrError}
            </div>
          )}
          <div className="mb-4 grid gap-3 lg:grid-cols-2">
            {/* Order details — a plain label/value list. Minimal, but every
                fact the desk needs before touching a date is right here. */}
            <section className="rounded-xl border border-zinc-200 dark:border-zinc-800">
              <dl className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                <DetailRow label="Order date">
                  <span className="font-medium text-zinc-800 dark:text-zinc-100">{fullDateLabel(order.createdDate)}</span>
                  <span className="ml-2 text-[11px] text-zinc-400">{ageLabel(order.createdDate, today)}</span>
                </DetailRow>
                <DetailRow label="Order value">
                  <span className="font-semibold tabular-nums">{inr(order.value)}</span>
                </DetailRow>
                <DetailRow label="Salesperson">{order.salesperson || "Unassigned"}</DetailRow>
                <DetailRow label="Payment terms">
                  {order.paymentTerms || <span className="italic text-zinc-400">Not in the Zoho terms</span>}
                </DetailRow>
              </dl>
            </section>
            <section className="space-y-3">
              <AddressCard label="Billing address" value={addrOverride?.billing ?? order.billingAddress} editedBy={addrOverride?.billingBy ?? order.billingAddressEditedBy} canEdit={floorWrite} saving={addrSaving} onSave={(t) => saveAddress("billing", t)} />
              <AddressCard label="Shipping address" value={addrOverride?.shipping ?? order.shippingAddress} editedBy={addrOverride?.shippingBy ?? order.shippingAddressEditedBy} canEdit={floorWrite} saving={addrSaving} onSave={(t) => saveAddress("shipping", t)} />
            </section>
          </div>
          {order.sourceState === "deleted_source" && (
            <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>
                  Zoho stopped returning this order{order.deletedDetectedAt ? ` on ${dateLabel(order.deletedDetectedAt.slice(0, 10))}` : ""}. It
                  stays on the floor until someone confirms — confirming deletes it here and keeps the audit trail.
                </p>
              </div>
              {canWrite && !promiseOnly && (
                <button
                  onClick={async () => {
                    const done = await actions.confirmRemoval(order.id);
                    if (done) {
                      onChanged();
                      onClose();
                    }
                  }}
                  disabled={actions.busy}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Confirm deletion
                </button>
              )}
            </div>
          )}

          {mode !== "view" && (
            <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
              {mode === "schedule" &&
                (promiseOnly
                  ? "Set the tentative dispatch date for each item — this is the promise the dispatch floor works to. Anything you cannot date needs a reason."
                  : "Pick the items going out and the tentative dispatch date for each. Anything you cannot date needs a reason — leave every item undated to keep the whole order unscheduled with one order-level reason.")}
              {mode === "dispatch" &&
                "Tick what is actually leaving today. Quantity defaults to the full remaining amount; a smaller number records a partial dispatch. Add the invoice PDF below — Mark dispatched stays locked until it is attached. Packing photos can be added if available."}
              {mode === "reschedule" &&
                "The committed date slipped. Give every selected item a new date and explain the slip — that reason is the audit trail."}
            </p>
          )}

          <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 text-left text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
                <tr>
                  {mode !== "view" && <th className="w-8 px-2 py-2" />}
                  <th className="px-2 py-2 font-semibold">Item</th>
                  <th className="px-2 py-2 text-right font-semibold">Qty</th>
                  <th className="px-2 py-2 font-semibold">State</th>
                  <th className="px-2 py-2 font-semibold">Committed</th>
                  {mode !== "view" && <th className="px-2 py-2 font-semibold">{mode === "dispatch" ? "Qty out" : "Date"}</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const overdue = isOverdueItem(it, today);
                  const due = isDueTodayItem(it, today);
                  const selectable = mode === "schedule" ? it.dispatchState !== "dispatched" : it.dispatchState === "scheduled";
                  return (
                    <tr key={it.id} className="border-t border-zinc-100 align-top dark:border-zinc-800/60">
                      {mode !== "view" && (
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            disabled={!selectable}
                            checked={picked.has(it.id)}
                            onChange={() => toggle(it.id)}
                            className="h-3.5 w-3.5 rounded border-zinc-300 accent-indigo-600 disabled:opacity-30"
                          />
                        </td>
                      )}
                      <td className="px-2 py-2">
                        <div className="font-medium text-zinc-800 dark:text-zinc-100">{it.name || it.description || "—"}</div>
                        {it.sku && <div className="font-mono text-[10px] text-zinc-500">{it.sku}</div>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                        {it.qty}
                        {it.unit ? ` ${it.unit}` : ""}
                        {it.dispatchedQty > 0 && it.dispatchState !== "dispatched" && (
                          <div className="text-[10px] text-violet-500">{it.dispatchedQty} out</div>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <ItemStateChip item={it} overdue={overdue} due={due} />
                      </td>
                      <td className="px-2 py-2 text-zinc-600 dark:text-zinc-300">
                        {dateLabel(it.tentativeDispatchDate)}
                        {it.delayReason && (
                          <div className="mt-0.5 max-w-[180px] text-[10px] text-amber-600 dark:text-amber-400">{it.delayReason}</div>
                        )}
                      </td>
                      {mode !== "view" && (
                        <td className="px-2 py-2">
                          {picked.has(it.id) ? (
                            mode === "dispatch" ? (
                              <input
                                type="number"
                                min={1}
                                max={Math.max(0, it.qty - it.dispatchedQty)}
                                placeholder={String(Math.max(0, it.qty - it.dispatchedQty))}
                                value={qty[it.id] ?? ""}
                                onChange={(e) => setQty((p) => ({ ...p, [it.id]: e.target.value }))}
                                className="w-20 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
                              />
                            ) : (
                              <input
                                type="date"
                                min={today}
                                value={dates[it.id] ?? ""}
                                onChange={(e) => setDates((p) => ({ ...p, [it.id]: e.target.value }))}
                                className="w-32 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
                              />
                            )
                          ) : (
                            <span className="text-[10px] text-zinc-400">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-xs text-zinc-500">
                      No line items captured yet — the Zoho detail fetch fills them on the next sync tick.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Dispatch proof — every Mark dispatched (even partial) consumes a
              fresh invoice PDF; packing photos, transport receipt, courier
              receipt and packing list ride along when the floor has them. Files
              upload on pick; the server burns them on dispatch. */}
          {mode === "dispatch" && (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Dispatch proof — invoice required
              </h3>
              <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-300">
                Each dispatch needs a fresh invoice PDF — it works once, so the next partial needs a new one.
                Packing photos, transport receipt, courier receipt and packing
                list can be added when available.
              </p>
              {/* Earlier batches on this SO — what already went out and in what
                  quantity, so the floor never double-dispatches blind. */}
              {(proofs.length > 0 || untrackedDispatched.length > 0) && (
                <div className="mt-2 rounded-xl border border-zinc-200 bg-white/70 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/60">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    Earlier dispatches
                  </p>
                  {proofs.length > 0 && (
                    <ul className="mt-1 space-y-1">
                      {proofs.map((p) => (
                        <li key={p.id} className="text-[11px] text-zinc-600 dark:text-zinc-300">
                          <span className="font-bold text-zinc-800 dark:text-zinc-100">{p.day || "dispatch"}</span>
                          {p.actor ? <span> · {p.actor}</span> : null}
                          {p.items && p.items.length > 0 ? (
                            <span> — {p.items.map((bi) => `${bi.qty}${bi.unit ? ` ${bi.unit}` : ""} × ${bi.name}`).join(" · ")}</span>
                          ) : (
                            <span> — batch details in the audit trail below</span>
                          )}
                          <span className="whitespace-nowrap">
                            {" "}·{" "}
                            <button
                              type="button"
                              onClick={() => openProofDoc(p.files?.invoice ?? proofFileFromId(p.invoiceId))}
                              className="border-0 bg-transparent p-0 font-bold text-indigo-600 hover:underline dark:text-indigo-400"
                            >
                              View
                            </button>
                            {" "}<a href={`/api/crm/files/${p.invoiceId}?download=1`} className="font-bold text-indigo-600 hover:underline dark:text-indigo-400">Download</a>
                            {!p.beforeId && <span className="text-amber-600 dark:text-amber-400"> · Before pending</span>}
                            {!p.afterId && <span className="text-amber-600 dark:text-amber-400"> · After pending</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {untrackedDispatched.length > 0 && (
                    <div className="mt-1">
                      <p className="text-[10px] font-semibold text-zinc-500">Dispatched before invoice tracking</p>
                      <ul className="mt-0.5 space-y-0.5">
                        {untrackedDispatched.map((u) => (
                          <li key={u.id} className="text-[11px] tabular-nums text-zinc-600 dark:text-zinc-300">
                            {u.qty}{u.unit ? ` ${u.unit}` : ""} × {u.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {PROOF_SLOTS.map((slot) => {

                  const meta = PROOF_SLOT_META[slot];
                  const done = !!proofIds[`${slot}Id` as keyof typeof proofIds];
                  return (
                    <label
                      key={slot}
                      className={`block rounded-xl border border-dashed px-3 py-2.5 text-[11px] transition-colors ${
                        done
                          ? "border-emerald-500/50 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                          : "border-zinc-300 text-zinc-500 hover:border-indigo-500 hover:text-indigo-600 dark:border-zinc-700 dark:hover:border-indigo-400"
                      } ${proofBusy ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
                    >
                      <span className="block text-[10px] font-bold uppercase tracking-wide">
                        {meta.label}
                      </span>
                      <span className="mt-0.5 block truncate font-semibold">
                        {proofBusy === slot ? "Uploading…" : done ? `✓ ${proofNames[slot]}` : meta.hint}
                      </span>
                      <input
                        type="file"
                        accept={meta.accept}
                        className="hidden"
                        disabled={!!proofBusy}
                        onChange={(e) => { void uploadProof(slot, e.target.files?.[0] ?? null); e.target.value = ""; }}
                      />
                    </label>
                  );
                })}
              </div>
              {proofError && <p className="mt-2 text-[11px] font-bold text-rose-500">{proofError}</p>}
            </div>
          )}

          {/* Reason inputs */}
          {mode === "schedule" && pickedItems.length > 0 && (
            <div className="mt-4 space-y-3">
              {!anyDated ? (
                <ReasonBox
                  label="Order-level delay reason (order stays Unscheduled)"
                  value={soReason}
                  onChange={setSoReason}
                />
              ) : (
                <>
                  <ReasonBox label="Order-level note" value={soReason} onChange={setSoReason} optional />
                  {pickedItems
                    .filter((it) => !dates[it.id])
                    .map((it) => (
                      <ReasonBox
                        key={it.id}
                        label={`Why can't "${it.name || it.sku || "item"}" go out?`}
                        value={reasons[it.id] ?? ""}
                        onChange={(v) => setReasons((p) => ({ ...p, [it.id]: v }))}
                      />
                    ))}
                </>
              )}
            </div>
          )}

          {mode === "reschedule" && (
            <div className="mt-4">
              <ReasonBox label="Comprehensive reason for the slip" value={moveReason} onChange={setMoveReason} />
            </div>
          )}

          {/* Consumed dispatch proofs — one batch per dispatch, newest first,
              plus anything that went out before invoice tracking existed.
              Missing packing photos show as Pending inside the proof (never on
              the lifecycle chips) and the floor can add them afterwards. */}
          {mode === "view" && (proofs.length > 0 || untrackedDispatched.length > 0) && (
            <div className="mt-5">
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Dispatch proofs</h3>
              <ul className="space-y-2">
                {proofs.map((p) => (
                  <ProofCard
                    key={p.id}
                    orderId={order.id}
                    soNumber={order.soNumber}
                    proof={p}
                    canWrite={floorWrite}
                    onOpenDoc={openProofDoc}
                    onChanged={loadDetail}
                  />
                ))}
                {untrackedDispatched.length > 0 && (
                  <li className="rounded-xl border border-dashed border-zinc-300 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                    <span className="font-bold">Dispatched before invoice tracking</span>
                    <ul className="mt-1 space-y-0.5 pl-5">
                      {untrackedDispatched.map((u) => (
                        <li key={u.id} className="tabular-nums">
                          {u.qty}{u.unit ? ` ${u.unit}` : ""} × {u.name}
                        </li>
                      ))}
                    </ul>
                  </li>
                )}

              </ul>
            </div>
          )}

          {events.length > 0 && mode === "view" && (
            <div className="mt-5">
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Audit trail</h3>
              <ul className="space-y-1.5">
                {events.map((e) => (
                  <li key={e.id} className="flex items-start gap-2 text-[11px] text-zinc-600 dark:text-zinc-300">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                    <span>
                      <b>{e.kind.replace(/_/g, " ")}</b>
                      {e.fromDate || e.toDate
                        ? ` · ${e.fromDate ? dateLabel(e.fromDate) : "—"} → ${e.toDate ? dateLabel(e.toDate) : "—"}`
                        : ""}
                      {e.qty ? ` · qty ${e.qty}` : ""}
                      {e.actor ? ` · ${e.actor}` : ""}
                      {e.reason ? <span className="block text-[10px] text-zinc-500">{e.reason}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        {mode !== "view" && (
          <footer className="shrink-0 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
            {!check.ok && picked.size > 0 && (
              <p className="mb-2 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" /> {check.message}
              </p>
            )}
            {actions.error && (
              <p className="mb-2 flex items-center gap-1.5 text-[11px] text-rose-600 dark:text-rose-400">
                <AlertTriangle className="h-3 w-3" /> {actions.error}
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-zinc-500">
                {picked.size} of {items.length} items selected
              </span>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={!check.ok || actions.busy || picked.size === 0}
                  className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
                >
                  {actions.busy ? "Saving…" : primary}
                </button>
              </div>
            </div>
          </footer>
        )}
        {proofLightbox && (
          <Lightbox
            images={proofLightbox.images}
            initialIndex={proofLightbox.index}
            image={null}
            onClose={() => setProofLightbox(null)}
          />
        )}
        {proofViewer && (
          <PdfViewer url={proofViewer.url} name={proofViewer.name} onClose={() => setProofViewer(null)} />
        )}
      </aside>
    </div>
  );
}

/** One dispatch batch: invoice + packing photos with View/Download, batch
 *  quantities, and Pending slots the floor can fill afterwards. The pending
 *  state lives inside this proof card — never on the lifecycle chips. */
function ProofCard({
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
  const [busy, setBusy] = useState<null | "before" | "after">(null);
  const [error, setError] = useState<string | null>(null);

  const addPhoto = async (slot: "before" | "after", file: File | null) => {
    if (!file || busy) return;
    if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
      setError("Packing photo must be an image.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError(`"${file.name}" exceeds 20MB.`);
      return;
    }
    setBusy(slot);
    setError(null);
    try {
      const id = await uploadProofFile(soNumber, slot === "before" ? "packing_before" : "packing_after", file);
      await crmApi.attachProofPhotos(orderId, proof.id, slot === "before" ? { beforeId: id } : { afterId: id });
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Could not attach photo — please retry.");
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
    canAddPhoto?: "before" | "after",
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
        ) : canAddPhoto ? (
          <span className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
              Pending
            </span>
            {canWrite && (
              <label className={`cursor-pointer font-bold text-indigo-600 hover:underline dark:text-indigo-400 ${busy ? "pointer-events-none opacity-60" : ""}`}>
                {busy === canAddPhoto ? "Uploading…" : "Add photo"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={!!busy}
                  onChange={(e) => { void addPhoto(canAddPhoto, e.target.files?.[0] ?? null); e.target.value = ""; }}
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
      <div className="mt-1 divide-y divide-zinc-100 dark:divide-zinc-800/60">
        {renderDoc("Invoice", "invoice")}
        {renderDoc("Before packing", "before", "before")}
        {renderDoc("After packing", "after", "after")}
        {renderDoc("Transport receipt", "transport")}
        {renderDoc("Courier receipt", "courier")}
        {renderDoc("Packing list", "packingList")}
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

function ItemStateChip({ item, overdue, due }: { item: CrmItem; overdue: boolean; due: boolean }) {  if (item.dispatchState === "dispatched") {
    return <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Dispatched</span>;
  }
  if (item.dispatchState === "scheduled") {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-semibold ${
          overdue ? "text-rose-600 dark:text-rose-400" : due ? "text-indigo-600 dark:text-indigo-400" : "text-sky-600 dark:text-sky-400"
        }`}
      >
        {overdue ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
        {overdue ? "Overdue" : due ? "Out today" : "Scheduled"}
      </span>
    );
  }
  return <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">{item.delayReason ? "Blocked" : "Unscheduled"}</span>;
}

function ReasonBox({
  label,
  value,
  onChange,
  optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}) {
  const short = value.trim().length > 0 && value.trim().length < REASON_MIN;
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-500">
        {label} {optional ? <em className="font-normal normal-case text-zinc-400">— if needed</em> : null}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder={optional ? "" : `At least ${REASON_MIN} characters…`}
        className={`w-full resize-y rounded-lg border bg-white px-3 py-2 text-xs outline-none focus:border-indigo-500 dark:bg-zinc-900 ${
          short ? "border-amber-400" : "border-zinc-300 dark:border-zinc-700"
        }`}
      />
      {short && <span className="mt-0.5 block text-[10px] text-amber-600 dark:text-amber-400">Keep going — {REASON_MIN - value.trim().length} more characters.</span>}
    </label>
  );
}
