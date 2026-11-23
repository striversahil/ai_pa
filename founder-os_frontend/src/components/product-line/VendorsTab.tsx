"use client";

// VendorsTab.tsx — the supplier master (kept across the rate wipe).
//
// Same interaction as the products and rates tabs (founder decision 2026-11-23):
// the row opens a right-hand drawer where every field is editable — no modal in
// the middle of the screen. Brand is NOT a vendor: brands live inside each
// quote's spec document.
import React, { useMemo, useState } from "react";
import { MapPin, Phone, Plus, Search, Trash2 } from "lucide-react";
import { ConfirmDialog, Drawer } from "@/components/ui";
import { dangerBtn, field, ghostBtn, label, panel, primaryBtn } from "../product-line-dashboard/helpers";
import { productLineApi } from "@/product-line/api";
import type { VendorRow } from "@/product-line/types";
import { TableSkeleton } from "./Skeletons";

const VENDOR_TYPES = ["manufacturer", "distributor", "trader"];
const errMsg = (e: unknown) => String((e as any)?.message ?? "save failed");

type Draft = {
  id?: string;
  name: string;
  contactPerson: string;
  contactPhone1: string;
  contactPhone2: string;
  location: string;
  address: string;
  yearEstablished: string;
  vendorType: string;
  active: boolean;
  rateCount?: number;
};

const emptyDraft = (): Draft => ({
  name: "", contactPerson: "", contactPhone1: "", contactPhone2: "", location: "",
  address: "", yearEstablished: "", vendorType: "manufacturer", active: true,
});

const draftFrom = (v: VendorRow): Draft => ({
  id: v.id,
  name: v.name,
  contactPerson: v.contactPerson ?? "",
  contactPhone1: v.contactPhone1 ?? "",
  contactPhone2: v.contactPhone2 ?? "",
  location: v.location ?? "",
  address: v.address ?? "",
  yearEstablished: v.yearEstablished != null ? String(v.yearEstablished) : "",
  vendorType: v.vendorType || "manufacturer",
  active: v.active,
  rateCount: v.rateCount,
});

const COLS = "minmax(0,1.6fr) minmax(0,1fr) minmax(0,1.2fr) 104px 68px";

interface Props {
  vendors: VendorRow[];
  loading: boolean;
  canEdit: boolean;
  onChanged: () => void;
}

export function VendorsTab({ vendors, loading, canEdit, onChanged }: Props) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<VendorRow | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vendors
      .filter((v) => (type ? (v.vendorType || "") === type : true))
      .filter((v) =>
        !needle
          ? true
          : [v.name, v.contactPerson, v.location, v.address, v.contactPhone1]
              .filter(Boolean)
              .some((f) => String(f).toLowerCase().includes(needle)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [vendors, q, type]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setErr(null);
    try {
      const body = {
        name: draft.name.trim(),
        contactPerson: draft.contactPerson.trim() || null,
        contactPhone1: draft.contactPhone1.trim() || null,
        contactPhone2: draft.contactPhone2.trim() || null,
        location: draft.location.trim() || null,
        address: draft.address.trim() || null,
        yearEstablished: draft.yearEstablished.trim() === "" ? null : Number(draft.yearEstablished),
        vendorType: draft.vendorType,
        active: draft.active,
      };
      if (draft.id) await productLineApi.updateVendor(draft.id, body as any);
      else await productLineApi.createVendor(body as any);
      setDraft(null);
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (v: VendorRow) => {
    setBusy(true);
    setErr(null);
    try {
      await productLineApi.deleteVendor(v.id);
      setDraft(null);
      onChanged();
    } catch (e) {
      // Server refuses while quotes reference the vendor — show its count.
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            className={`${field} pl-9 w-64`}
            placeholder="Search vendor, person, city…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select className={`${field} w-44`} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {VENDOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="text-[11px] font-semibold text-[var(--text-tertiary)]">
          {rows.length} of {vendors.length} vendors
        </span>
        {canEdit ? (
          <button type="button" className={`${primaryBtn} ml-auto`} onClick={() => { setErr(null); setDraft(emptyDraft()); }}>
            <Plus size={13} /> New vendor
          </button>
        ) : null}
      </div>

      <div className={`${panel} overflow-hidden`}>
        <div className="grid gap-2 px-4 py-2 border-b border-[var(--border-card)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]" style={{ gridTemplateColumns: COLS }}>
          <span>Vendor</span><span>Contact</span><span>Location</span><span>Type</span><span className="text-right">Quotes</span>
        </div>
        {loading && !vendors.length ? <TableSkeleton rows={8} /> : (
          <div className="divide-y divide-[var(--border-card)]/60">
            {rows.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => { setErr(null); setDraft(draftFrom(v)); }}
                className="w-full grid gap-2 px-4 py-2 items-center text-left hover:bg-[var(--bg-input)] transition-colors"
                style={{ gridTemplateColumns: COLS }}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-[var(--text-primary)] truncate">{v.name}</span>
                  <span className="block text-[10px] text-[var(--text-tertiary)]">
                    {v.yearEstablished ? `since ${v.yearEstablished}` : v.active ? "active" : "inactive"}
                  </span>
                </span>
                <span className="min-w-0 text-[11px] text-[var(--text-secondary)]">
                  <span className="block truncate">{v.contactPerson ?? "—"}</span>
                  {v.contactPhone1 ? (
                    <span className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]"><Phone size={9} />{v.contactPhone1}</span>
                  ) : null}
                </span>
                <span className="min-w-0 text-[11px] text-[var(--text-secondary)] flex items-center gap-1">
                  <MapPin size={9} className="text-[var(--text-tertiary)] shrink-0" />
                  <span className="truncate">{v.location ?? "—"}</span>
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">{v.vendorType || "—"}</span>
                <span className="text-right text-[11px] tabular-nums text-[var(--text-secondary)]">{v.rateCount}</span>
              </button>
            ))}
            {!rows.length && !loading ? (
              <div className="px-4 py-10 text-center text-xs text-[var(--text-tertiary)]">
                {vendors.length ? "No vendor matches this search." : "No vendors yet."}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {draft ? (
        <Drawer
          title={draft.id ? draft.name || "Vendor" : "New vendor"}
          subtitle={draft.id ? `${draft.rateCount ?? 0} quotes on file · ${draft.vendorType}` : "supplier master · brands are not vendors"}
          onClose={() => setDraft(null)}
          width="max-w-2xl"
        >
          <div className="space-y-3">
            {err ? <div className="text-xs font-semibold text-[var(--color-danger)] bg-[var(--bg-input)] rounded-xl px-3 py-2">{err}</div> : null}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><span className={label}>Vendor name</span>
                <input className={field} autoFocus value={draft.name} disabled={!canEdit}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
              <div><span className={label}>Contact person</span>
                <input className={field} value={draft.contactPerson} disabled={!canEdit}
                  onChange={(e) => setDraft({ ...draft, contactPerson: e.target.value })} /></div>
              <div><span className={label}>Vendor type</span>
                <select className={field} value={draft.vendorType} disabled={!canEdit}
                  onChange={(e) => setDraft({ ...draft, vendorType: e.target.value })}>
                  {VENDOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select></div>
              <div><span className={label}>Phone 1</span>
                <input className={field} value={draft.contactPhone1} disabled={!canEdit}
                  onChange={(e) => setDraft({ ...draft, contactPhone1: e.target.value })} /></div>
              <div><span className={label}>Phone 2</span>
                <input className={field} value={draft.contactPhone2} disabled={!canEdit}
                  onChange={(e) => setDraft({ ...draft, contactPhone2: e.target.value })} /></div>
              <div><span className={label}>Location (city)</span>
                <input className={field} value={draft.location} disabled={!canEdit}
                  onChange={(e) => setDraft({ ...draft, location: e.target.value })} /></div>
              <div><span className={label}>Year established</span>
                <input className={field} inputMode="numeric" value={draft.yearEstablished} disabled={!canEdit}
                  onChange={(e) => setDraft({ ...draft, yearEstablished: e.target.value })} /></div>
              <div className="col-span-2"><span className={label}>Address</span>
                <input className={field} value={draft.address} disabled={!canEdit}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })} /></div>
              <div className="col-span-2 flex items-center gap-2">
                <span className={label}>Status</span>
                <select className={`${field} w-40`} value={draft.active ? "on" : "off"} disabled={!canEdit}
                  onChange={(e) => setDraft({ ...draft, active: e.target.value === "on" })}>
                  <option value="on">active — offered to buyers</option>
                  <option value="off">inactive — hidden from the prompt</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--border-card)] pt-3">
              {canEdit ? (
                <button type="button" className={primaryBtn} disabled={busy || !draft.name.trim()} onClick={() => void save()}>
                  {draft.id ? "Save vendor" : "Create vendor"}
                </button>
              ) : null}
              <button type="button" className={ghostBtn} onClick={() => setDraft(null)}>Close</button>
              {draft.id && canEdit ? (
                <button
                  type="button"
                  className={`${dangerBtn} ml-auto`}
                  disabled={busy}
                  onClick={() => {
                    const v = vendors.find((x) => x.id === draft.id);
                    if (v) setConfirmDelete(v);
                  }}
                >
                  <Trash2 size={13} /> Delete
                </button>
              ) : null}
            </div>
          </div>
        </Drawer>
      ) : null}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this vendor?"
        message={
          <>
            <b>{confirmDelete?.name}</b> is removed from the supplier master. If any quote references it the delete is
            refused — delete those rates first. Vendors created by a paste can also be removed by deleting that batch.
          </>
        }
        confirmLabel="Delete vendor"
        busy={busy}
        onConfirm={() => {
          const v = confirmDelete;
          setConfirmDelete(null);
          if (v) void remove(v);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
