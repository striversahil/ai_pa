"use client";

// RateDrawer.tsx — one vendor rate, in full, editable.
//
// Left: the quote envelope (vendor, product, price/discount/net, unit, MOQ,
// packaging, lead time, date, media, notes). Right: the product's typed spec
// contract, so the drawer is the same checklist the API validates on save.
// Adding is the same form with empty values ("New rate" from the sheet).
import React, { useMemo, useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { ConfirmDialog, Drawer } from "@/components/ui";
import { dangerBtn, field, fmtINR, ghostBtn, label, primaryBtn } from "../product-line-dashboard/helpers";
import { productLineApi } from "@/product-line/api";
import { missingFields } from "@/product-line/filters";
import type { KypProduct, KypSpec, RateRow, VendorRow } from "@/product-line/types";
import { DrawerSkeleton } from "./Skeletons";

const UNITS = ["pcs", "meter", "sq_meter", "kg", "set", "pair", "packet", "box", "roll", "bale", "sheet"];
const errMsg = (e: unknown) => String((e as any)?.message ?? "save failed");

export interface RateDraft {
  vendorId: string;
  productId: string;
  unit: string;
  moq: string;
  pricePerUnit: string;
  discountPercent: string;
  weightPerUnit: string;
  packageQty: string;
  packageDims: string;
  deliveryDays: string;
  deliveryMaxDays: string;
  quotedAt: string;
  enquiryRef: string;
  notes: string;
  imageUrl: string;
  videoUrl: string;
  attrValues: Record<string, string>;
}

function draftFrom(rate: RateRow | null, productId = ""): RateDraft {
  const specs: Record<string, string> = {};
  for (const [k, v] of Object.entries(rate?.attrValues ?? {})) {
    specs[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
  }
  return {
    vendorId: rate?.vendorId ?? "",
    productId: rate?.productId ?? productId,
    unit: rate?.unit ?? "pcs",
    moq: rate?.moq ?? "",
    pricePerUnit: rate?.pricePerUnit != null ? String(rate.pricePerUnit) : "",
    discountPercent: rate?.discountPercent != null ? String(rate.discountPercent) : "",
    weightPerUnit: rate?.weightPerUnit != null ? String(rate.weightPerUnit) : "",
    packageQty: rate?.packageQty ?? "",
    packageDims: rate?.packageDims ?? "",
    deliveryDays: rate?.deliveryDays != null ? String(rate.deliveryDays) : "",
    deliveryMaxDays: rate?.deliveryMaxDays != null ? String(rate.deliveryMaxDays) : "",
    quotedAt: (rate?.quotedAt ?? new Date().toISOString()).slice(0, 10),
    enquiryRef: rate?.enquiryRef ?? "",
    notes: rate?.notes ?? "",
    imageUrl: rate?.imageUrl ?? "",
    videoUrl: rate?.videoUrl ?? "",
    attrValues: specs,
  };
}

interface Props {
  rateId: string | null;
  rate: RateRow | null;
  product: { props: Record<string, KypSpec>; required: string[]; label: string } | null;
  products: KypProduct[];
  vendors: VendorRow[];
  loading: boolean;
  canEdit: boolean;
  defaultProductId?: string;
  onClose: () => void;
  onChanged: () => void;
}

export function RateDrawer({ rateId, rate, product, products, vendors, loading, canEdit, defaultProductId, onClose, onChanged }: Props) {
  const [draft, setDraft] = useState<RateDraft>(() => draftFrom(rate, defaultProductId));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [specKey, setSpecKey] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Re-seed the form when a different row arrives (drawer reuse).
  React.useEffect(() => {
    setDraft(draftFrom(rate, defaultProductId));
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate?.id, defaultProductId]);

  const productOfDraft = useMemo(
    () => products.find((p) => p.id === draft.productId) ?? null,
    [products, draft.productId],
  );
  const specs: Record<string, KypSpec> = product?.props ?? productOfDraft?.props ?? {};
  const required = product?.required ?? productOfDraft?.required ?? [];
  const net = useMemo(() => {
    const price = Number(draft.pricePerUnit);
    const disc = Number(draft.discountPercent || 0);
    if (!Number.isFinite(price) || price <= 0) return null;
    return Math.round(price * (1 - Math.min(100, Math.max(0, disc)) / 100) * 100) / 100;
  }, [draft.pricePerUnit, draft.discountPercent]);

  const missing = useMemo(
    () =>
      missingFields(
        {
          attrValues: draft.attrValues,
          unit: draft.unit,
          moq: draft.moq,
          pricePerUnit: draft.pricePerUnit === "" ? null : Number(draft.pricePerUnit),
          deliveryDays: draft.deliveryDays === "" ? null : Number(draft.deliveryDays),
          quotedAt: draft.quotedAt,
        },
        { props: specs, required },
      ),
    [draft, specs, required],
  );

  const setSpec = (key: string, value: string) => setDraft((d) => ({ ...d, attrValues: { ...d.attrValues, [key]: value } }));

  // A new quote starts with the spec defaults the founder declared (2026-11-23):
  // the vendor sheet is silent on them often enough that retyping is friction.
  const seededFor = React.useRef<string>("");
  React.useEffect(() => {
    if (rateId || !draft.productId || seededFor.current === draft.productId) return;
    const list = productOfDraft?.props ?? {};
    const seeded: Record<string, string> = {};
    for (const [key, spec] of Object.entries(list)) {
      if (spec?.default === undefined || spec.default === null) continue;
      seeded[key] = Array.isArray(spec.default) ? spec.default.join(", ") : String(spec.default);
    }
    seededFor.current = draft.productId;
    if (Object.keys(seeded).length) {
      setDraft((d) => ({ ...d, attrValues: { ...seeded, ...d.attrValues } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.productId, rateId]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const attrValues: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(draft.attrValues)) {
        if (String(v ?? "").trim() === "") continue;
        attrValues[k] = specs[k]?.type === "array" ? String(v).split(",").map((s) => s.trim()).filter(Boolean) : v;
      }
      const body: Record<string, unknown> = {
        vendorId: draft.vendorId,
        productId: draft.productId || null,
        attrValues,
        unit: draft.unit,
        moq: draft.moq,
        pricePerUnit: draft.pricePerUnit === "" ? null : Number(draft.pricePerUnit),
        discountPercent: draft.discountPercent === "" ? null : Number(draft.discountPercent),
        weightPerUnit: draft.weightPerUnit === "" ? null : Number(draft.weightPerUnit),
        packageQty: draft.packageQty || null,
        packageDims: draft.packageDims || null,
        deliveryDays: draft.deliveryDays === "" ? null : Number(draft.deliveryDays),
        deliveryMaxDays: draft.deliveryMaxDays === "" ? null : Number(draft.deliveryMaxDays),
        quotedAt: draft.quotedAt || null,
        enquiryRef: draft.enquiryRef || null,
        notes: draft.notes || null,
        imageUrl: draft.imageUrl || null,
        videoUrl: draft.videoUrl || null,
      };
      if (rateId) await productLineApi.updateRate(rateId, body);
      else await productLineApi.createRate(body);
      onChanged();
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!rateId) return;
    setBusy(true);
    setErr(null);
    try {
      await productLineApi.deleteRate(rateId);
      onChanged();
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const keys = Object.keys(specs);

  return (
    <Drawer
      title={rateId ? rate?.productName ?? "Vendor rate" : "New vendor rate"}
      subtitle={<>{rate?.vendorName ? `${rate.vendorName} · ` : ""}{net != null ? `net ${fmtINR(net)} / ${draft.unit || "unit"}` : "net rate —"}</>}
      onClose={onClose}
      width="max-w-3xl"
    >
      <div className="space-y-4">
          {loading ? <DrawerSkeleton /> : null}
          {err ? <div className="text-xs font-semibold text-[var(--color-danger)] bg-[var(--bg-input)] rounded-xl px-3 py-2">{err}</div> : null}

          {!loading ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={label}>Vendor</span>
                  <select className={field} value={draft.vendorId} onChange={(e) => setDraft({ ...draft, vendorId: e.target.value })} disabled={!canEdit}>
                    <option value="">Select vendor…</option>
                    {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div>
                  <span className={label}>Product</span>
                  <select className={field} value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value, attrValues: {} })} disabled={!canEdit}>
                    <option value="">Unlinked</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
                <div><span className={label}>Price per unit (₹, before discount)</span>
                  <input className={field} inputMode="decimal" value={draft.pricePerUnit} onChange={(e) => setDraft({ ...draft, pricePerUnit: e.target.value })} disabled={!canEdit} /></div>
                <div><span className={label}>Discount %</span>
                  <input className={field} inputMode="decimal" value={draft.discountPercent} onChange={(e) => setDraft({ ...draft, discountPercent: e.target.value })} disabled={!canEdit} /></div>
                <div><span className={label}>Unit of sale</span>
                  <select className={field} value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} disabled={!canEdit}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select></div>
                <div><span className={label}>MOQ</span>
                  <input className={field} inputMode="numeric" value={draft.moq} onChange={(e) => setDraft({ ...draft, moq: e.target.value })} disabled={!canEdit} /></div>
                <div><span className={label}>Weight / unit (kg)</span>
                  <input className={field} inputMode="decimal" value={draft.weightPerUnit} onChange={(e) => setDraft({ ...draft, weightPerUnit: e.target.value })} disabled={!canEdit} /></div>
                <div><span className={label}>Package qty</span>
                  <input className={field} value={draft.packageQty} onChange={(e) => setDraft({ ...draft, packageQty: e.target.value })} disabled={!canEdit} /></div>
                <div><span className={label}>Package dims (L×W×H cm)</span>
                  <input className={field} value={draft.packageDims} onChange={(e) => setDraft({ ...draft, packageDims: e.target.value })} disabled={!canEdit} /></div>
                <div><span className={label}>Date added</span>
                  <input className={field} type="date" value={draft.quotedAt} onChange={(e) => setDraft({ ...draft, quotedAt: e.target.value })} disabled={!canEdit} /></div>
                <div><span className={label}>Delivery days</span>
                  <input className={field} inputMode="numeric" value={draft.deliveryDays} onChange={(e) => setDraft({ ...draft, deliveryDays: e.target.value })} disabled={!canEdit} /></div>
                <div><span className={label}>Delivery max days (range)</span>
                  <input className={field} inputMode="numeric" value={draft.deliveryMaxDays} onChange={(e) => setDraft({ ...draft, deliveryMaxDays: e.target.value })} disabled={!canEdit} /></div>
                <div><span className={label}>Enquiry ref</span>
                  <input className={field} value={draft.enquiryRef} onChange={(e) => setDraft({ ...draft, enquiryRef: e.target.value })} disabled={!canEdit} /></div>
                <div><span className={label}>Net rate (derived)</span>
                  <input className={`${field} font-bold`} value={net != null ? fmtINR(net) : "—"} readOnly /></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><span className={label}>Photo URL / KV path</span>
                  <input className={field} value={draft.imageUrl} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} disabled={!canEdit} /></div>
                <div><span className={label}>Video URL</span>
                  <input className={field} value={draft.videoUrl} onChange={(e) => setDraft({ ...draft, videoUrl: e.target.value })} disabled={!canEdit} /></div>
                <div className="col-span-2"><span className={label}>Notes</span>
                  <textarea className={`${field} min-h-16`} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} disabled={!canEdit} /></div>
              </div>

              <div className="border-t border-[var(--border-card)] pt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={label}>Specs {required.length ? `(${required.length} required)` : ""}</span>
                  {missing.length ? (
                    <span className="ml-auto flex flex-wrap gap-1">
                      {missing.map((m) => (
                        <span key={m} className="px-1.5 py-0.5 rounded-md bg-[color-mix(in_srgb,var(--color-danger)_14%,transparent)] text-[10px] font-bold text-[var(--color-danger)]">{m}</span>
                      ))}
                    </span>
                  ) : <span className="ml-auto text-[11px] font-bold text-emerald-600">all required answered</span>}
                </div>

                {keys.map((key) => {
                  const spec = specs[key];
                  const value = draft.attrValues[key] ?? "";
                  const isReq = required.includes(key);
                  return (
                    <div key={key} className="grid grid-cols-[minmax(0,180px)_1fr] items-center gap-2">
                      <span className="text-[11px] font-semibold text-[var(--text-secondary)] truncate" title={key}>
                        {spec?.label ?? key}
                        {isReq ? <span className="text-[var(--color-danger)]"> *</span> : null}
                      </span>
                      {spec?.enum?.length ? (
                        <select className={field} value={value} onChange={(e) => setSpec(key, e.target.value)} disabled={!canEdit}>
                          <option value="">—</option>
                          {spec.enum.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : spec?.type === "boolean" ? (
                        <select className={field} value={value} onChange={(e) => setSpec(key, e.target.value)} disabled={!canEdit}>
                          <option value="">—</option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : (
                        <input
                          className={field}
                          inputMode={spec?.type === "number" || spec?.type === "integer" ? "decimal" : "text"}
                          placeholder={spec?.type === "array" ? "comma separated" : ""}
                          value={value}
                          onChange={(e) => setSpec(key, e.target.value)}
                          disabled={!canEdit}
                        />
                      )}
                    </div>
                  );
                })}

                <div className="flex items-center gap-1.5 pt-1">
                  <input className={`${field} w-48`} placeholder="extra key (e.g. brand)" value={specKey} onChange={(e) => setSpecKey(e.target.value)} />
                  <button
                    type="button"
                    className={ghostBtn}
                    disabled={!canEdit || !specKey.trim()}
                    onClick={() => { setSpec(specKey.trim(), ""); setSpecKey(""); }}
                  >
                    + Add field
                  </button>
                  <span className="text-[10px] text-[var(--text-tertiary)]">brand / material / machine_make_model are always accepted</span>
                </div>
              </div>

              <div className="flex items-center gap-2 border-t border-[var(--border-card)] pt-3">
                <button type="button" className={primaryBtn} disabled={!canEdit || busy} onClick={() => void save()}>
                  <Save size={13} /> {rateId ? "Save rate" : "Create rate"}
                </button>
                {rateId ? (
                  <>
                    <button type="button" className={ghostBtn} disabled={!canEdit || busy}
                      onClick={() => { void productLineApi.setRateActive(String(rateId), !(rate?.active ?? true)).then(onChanged); }}>
                      {rate?.active ? "Turn off" : "Turn on"}
                    </button>
                    <button type="button" className={`${dangerBtn} ml-auto`} disabled={!canEdit || busy} onClick={() => setConfirmDelete(true)}>
                      <Trash2 size={13} /> Delete
                    </button>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this vendor rate?"
        message={
          <>
            The quote from <b>{rate?.vendorName ?? "this vendor"}</b>
            {rate?.productName ? <> for <b>{rate.productName}</b></> : null} disappears completely — price, specs and its
            row in the spec index. This cannot be undone.
          </>
        }
        confirmLabel="Delete rate"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Drawer>
  );
}
