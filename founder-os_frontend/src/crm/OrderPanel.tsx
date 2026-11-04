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
import type { CrmItem, CrmOrder } from "./types";
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
import { api } from "@/api/client";
import { REGIONS } from "@/telecalling/regions";
import SoAttachments from "@/components/SoAttachments";

export type PanelMode = "view" | "schedule" | "dispatch" | "reschedule";

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
  const items = order.items || [];
  const [attachments, setAttachments] = useState<any[]>([]);

  // SO documents (invoice / LR / POD) are keyed by SO number, not by the row
  // id — the uploader is unchanged, so the floor keeps that capability.
  const loadAttachments = React.useCallback(() => {
    if (!order.soNumber) return;
    api
      .get<{ attachments: any[] }>(`/crm/attachments?so=${encodeURIComponent(order.soNumber)}`)
      .then((r) => setAttachments(Array.isArray(r?.attachments) ? r.attachments : []))
      .catch(() => setAttachments([]));
  }, [order.soNumber]);

  useEffect(() => {
    loadAttachments();
  }, [loadAttachments]);

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
  // triple — invoice PDF + before-packing + after-packing photo. Files upload
  // the moment they're picked (SoAttachment IDs); the dispatch call sends the
  // three IDs and the server burns them. Starts empty on every open so a
  // consumed triple can never be re-picked for a repeat partial.
  type ProofSlot = "invoice" | "before" | "after";
  const PROOF_SLOT_META: Record<ProofSlot, { label: string; kind: string; accept: string; hint: string; optional: boolean }> = {
    invoice: { label: "Invoice PDF", kind: "invoice", accept: "application/pdf,.pdf", hint: "The invoice for this dispatch", optional: false },
    before: { label: "Before packing (optional)", kind: "packing_before", accept: "image/*", hint: "Photo before packing", optional: true },
    after: { label: "After packing (optional)", kind: "packing_after", accept: "image/*", hint: "Photo after packing", optional: true },
  };
  const [proofIds, setProofIds] = useState<{ invoiceId: string | null; beforeId: string | null; afterId: string | null }>({
    invoiceId: null, beforeId: null, afterId: null,
  });
  const [proofNames, setProofNames] = useState<{ invoice: string; before: string; after: string }>({
    invoice: "", before: "", after: "",
  });
  const [proofBusy, setProofBusy] = useState<ProofSlot | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);

  useEffect(() => {
    setProofIds({ invoiceId: null, beforeId: null, afterId: null });
    setProofNames({ invoice: "", before: "", after: "" });
    setProofError(null);
  }, [order.id]);

  const uploadProof = async (slot: ProofSlot, file: File | null) => {
    if (!file || proofBusy) return;
    if (slot === "invoice" && file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      setProofError("Invoice must be a PDF file.");
      return;
    }
    if (slot !== "invoice" && !file.type.startsWith("image/") && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
      setProofError("Packing proof must be a photo.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setProofError(`"${file.name}" exceeds 20MB.`);
      return;
    }
    setProofBusy(slot);
    setProofError(null);
    try {
      const fd = new FormData();
      fd.append("soNumber", order.soNumber);
      fd.append("kind", PROOF_SLOT_META[slot].kind);
      fd.append("file", file);
      const res = await fetch("/api/crm/attachments", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      const id = String(data?.attachment?.id || "");
      if (!id) throw new Error("Upload failed — please retry.");
      setProofIds((p) => ({ ...p, [`${slot}Id`]: id }));
      setProofNames((p) => ({ ...p, [slot]: file.name }));
      loadAttachments();
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
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pickedItems = items.filter((it) => picked.has(it.id));

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
                "Tick what is actually leaving today. Quantity defaults to the full remaining amount; a smaller number records a partial dispatch. Add the invoice PDF below — Mark dispatched stays locked until it is attached (packing photos optional)."}
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
              fresh invoice PDF; packing photos are optional extras. Files
              upload on pick; the server burns the invoice on dispatch. */}
          {mode === "dispatch" && (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Dispatch proof — invoice required
              </h3>
              <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-300">
                Each dispatch needs a fresh invoice PDF — it works once, so the next partial needs a new one.
                Before/after packing photos are optional; attach them when you have them.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {(Object.keys(PROOF_SLOT_META) as Array<"invoice" | "before" | "after">).map((slot) => {
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
                      <span className="block text-[10px] font-bold uppercase tracking-wide">{meta.label}</span>
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
                  <ReasonBox label="Order-level note (optional)" value={soReason} onChange={setSoReason} optional />
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

          {mode === "view" && (
            <div className="mt-5">
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">SO documents</h3>
              <SoAttachments so={order.soNumber} attachments={attachments} canManage={floorWrite} onChanged={loadAttachments} />
            </div>
          )}

          {/* Consumed dispatch proofs — one triple per dispatch, newest first. */}
          {mode === "view" && order.proofs && order.proofs.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Dispatch proofs</h3>
              <ul className="space-y-1.5">
                {order.proofs.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                    <span>
                      <b>{p.day || "dispatch"}</b>
                      {p.actor ? ` · ${p.actor}` : ""}
                    </span>
                    <span className="flex gap-2">
                      <a href={`/api/crm/files/${p.invoiceId}`} target="_blank" rel="noopener" className="font-bold text-indigo-600 hover:underline dark:text-indigo-400">Invoice</a>
                      {p.beforeId ? (
                        <a href={`/api/crm/files/${p.beforeId}`} target="_blank" rel="noopener" className="font-bold text-indigo-600 hover:underline dark:text-indigo-400">Before</a>
                      ) : (
                        <span className="text-zinc-400">Before —</span>
                      )}
                      {p.afterId ? (
                        <a href={`/api/crm/files/${p.afterId}`} target="_blank" rel="noopener" className="font-bold text-indigo-600 hover:underline dark:text-indigo-400">After</a>
                      ) : (
                        <span className="text-zinc-400">After —</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {order.events && order.events.length > 0 && mode === "view" && (
            <div className="mt-5">
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Audit trail</h3>
              <ul className="space-y-1.5">
                {order.events.map((e) => (
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
      </aside>
    </div>
  );
}

function ItemStateChip({ item, overdue, due }: { item: CrmItem; overdue: boolean; due: boolean }) {
  if (item.dispatchState === "dispatched") {
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
        {label} {optional ? <em className="font-normal normal-case text-zinc-400">(optional)</em> : null}
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
