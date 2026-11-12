"use client";

import { useEffect, useMemo, useState } from "react";
import type { DuplicateReview, MasterCustomer, MasterCustomerDetail, TypeBaseEntry } from "@/master-data/types";
import { getMasterCustomer, getTypeBases, patchMasterCustomer, deleteMasterCustomer, setDuplicateReview } from "@/master-data/api";
import {
  REVIEW_LABELS, countHint, formatDate, formatPhone, initials,
  regionLabel, telHref,
} from "@/master-data/normalize";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import {
  Drawer, Field, GhostButton, PrimaryButton, ReadOnlyValue, SectionTitle, inputClass,
} from "./ui";
import type { Draft } from "./customer-drawer/types";
import { toDraft, draftToPatch, REGIONS } from "./customer-drawer/helpers";
import { ChipRow } from "./customer-drawer/ChipRow";
import { Pill } from "./customer-drawer/Pill";

export default function CustomerDrawer({
  customerId, seed, canEdit, canManage, canDelete, onClose, onSaved, onDeleted,
}: {
  customerId: string | null;
  seed: MasterCustomer | null;
  canEdit: boolean;
  canManage: boolean;
  /** Sales-head only (server-enforced) — the danger zone stays hidden otherwise. */
  canDelete: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: (name: string) => void;
  
}) {
  const [detail, setDetail] = useState<MasterCustomerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [typeBases, setTypeBases] = useState<TypeBaseEntry[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (!customerId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setEditing(false);
    setSaveError(null);
    getMasterCustomer(customerId)
      .then((c) => {
        if (!alive) return;
        setDetail(c);
        setDraft(toDraft(c));
      })
      .catch((e: any) => { if (alive) setError(e?.message || "Could not load this customer"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [customerId]);

  // Sales-head's allowed client-type vocabulary for the type dropdown.
  useEffect(() => {
    if (!customerId) return;
    let alive = true;
    getTypeBases()
      .then((b) => { if (alive) setTypeBases(b); })
      .catch(() => { /* read-only fallback: free text still validates server-side */ });
    return () => { alive = false; };
  }, [customerId]);

  const original = useMemo(() => (detail ? toDraft(detail) : null), [detail]);
  const patch = useMemo(
    () => (draft && original ? draftToPatch(draft, original, canManage) : {}),
    [draft, original, canManage],
  );
  const changedKeys = Object.keys(patch);

  const shown: (MasterCustomer & Partial<MasterCustomerDetail>) | null = detail ?? seed;
  if (!customerId || !shown) return null;

  const set = (key: keyof Draft, value: string) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const save = async () => {
    if (!detail || changedKeys.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await patchMasterCustomer(detail.id, patch);
      setDetail(updated);
      setDraft(toDraft(updated));
      setEditing(false);
      onSaved();
    } catch (e: any) {
      setSaveError(e?.message || "Could not save the record");
    } finally {
      setSaving(false);
    }
  };

  const review = async (next: DuplicateReview) => {
    if (!detail?.duplicateGroup) return;
    setReviewBusy(true);
    setSaveError(null);
    try {
      const res = await setDuplicateReview(detail.duplicateGroup, next);
      setDetail((d) => (d ? { ...d, duplicateReview: res.review } : d));
      onSaved();
    } catch (e: any) {
      setSaveError(e?.message || "Could not update the duplicate review");
    } finally {
      setReviewBusy(false);
    }
  };

  const remove = async () => {
    if (!detail || deleteBusy) return;
    setDeleteBusy(true);
    setSaveError(null);
    try {
      const res = await deleteMasterCustomer(detail.id);
      setConfirmDelete(false);
      onDeleted?.(res.name);
    } catch (e: any) {
      setSaveError(e?.message || "Could not delete this client");
      setConfirmDelete(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <Drawer
      open={!!customerId}
      onClose={onClose}
      title={
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-xs font-extrabold text-indigo-600 dark:text-indigo-400">
            {initials(shown.name)}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{shown.name}</h3>
            <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
              {[shown.company && shown.company !== shown.name ? shown.company : "", shown.city, regionLabel(shown.region)]
                .filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      }
      subtitle={
        <ChipRow>
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">{shown.status}</span>
          <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">{regionLabel(shown.region)}</span>
          {shown.duplicateGroup && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">Dup {shown.duplicateGroup}</span>}
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">Zoho #{shown.zohoCustomerId}</span>
        </ChipRow>
      }
      footer={
        canEdit ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
              {editing
                ? changedKeys.length === 0 ? "No changes yet" : `${changedKeys.length} field${changedKeys.length === 1 ? "" : "s"} changed`
                : "Appointed editors can correct this record"}
            </span>
            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <GhostButton onClick={() => { setDraft(original); setEditing(false); setSaveError(null); }}>Cancel</GhostButton>
                  <PrimaryButton onClick={save} disabled={saving || changedKeys.length === 0}>
                    {saving ? "Saving…" : "Save changes"}
                  </PrimaryButton>
                </>
              ) : (
                <PrimaryButton onClick={() => setEditing(true)} disabled={loading || !detail}>Edit record</PrimaryButton>
              )}
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            Read-only — only editors appointed by the sales-head can change customer records.
          </p>
        )
      }
    >
      {loading && <p className="animate-pulse text-sm text-zinc-500 dark:text-zinc-400">Loading the full record…</p>}
      {error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      {saveError && <p className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">{saveError}</p>}

      <div className="space-y-4">
        {/* Identity — the main name and company. displayName is what every
            list, leaderboard match and campaign push shows. */}
        <section className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
          <SectionTitle hint={editing ? "Shown everywhere — keep it recognisable" : undefined}>Identity</SectionTitle>
          {editing && draft ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Display name" hint="The main name">
                <input className={inputClass} value={draft.displayName} onChange={(e) => set("displayName", e.target.value)} maxLength={200} />
              </Field>
              <Field label="Company name" hint="Leave blank if same as above">
                <input className={inputClass} value={draft.companyName} onChange={(e) => set("companyName", e.target.value)} maxLength={200} />
              </Field>
            </div>
          ) : (
            <div>
              <p className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100">{shown.name || "—"}</p>
              {shown.company && shown.company !== shown.name && (
                <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{shown.company}</p>
              )}
            </div>
          )}
        </section>

        {/* Client type — base from the sales-head's allowed list, free qualifier */}
        <section className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
          <SectionTitle hint={editing ? "Base: sales-head's list · qualifier: free" : undefined}>Client type</SectionTitle>
          {editing && draft ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Type" hint={typeBases.length ? `${typeBases.length} allowed` : "Sales-head owns this list"}>
                <select className={inputClass} value={draft.customerType} onChange={(e) => set("customerType", e.target.value)}>
                  {typeBases.length === 0 && <option value={draft.customerType}>{draft.customerType || "Loading…"}</option>}
                  {typeBases.map((t) => (
                    <option key={t.base} value={t.base}>
                      {t.base}{t.segment === "consumer" ? " · consumer" : t.segment === "reseller" ? " · reseller" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Qualifier" hint="State/tag, e.g. MP">
                <input className={inputClass} value={draft.typeTag} onChange={(e) => set("typeTag", e.target.value.toUpperCase())} maxLength={12} />
              </Field>
              {(() => {
                const seg = typeBases.find((t) => t.base === draft.customerType)?.segment ?? "";
                return seg ? (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 sm:col-span-2">
                    Maps to <strong>{seg === "consumer" ? "end consumer" : "reseller"}</strong> in the leaderboard target — changing it re-maps this client's segment.
                  </p>
                ) : (
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 sm:col-span-2">
                    No segment mapped — this client stays unclassified until the sales-head maps the family.
                  </p>
                );
              })()}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{shown.typeBase || "Unspecified"}</span>
              {shown.typeTag && <span className="rounded bg-zinc-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">{shown.typeTag}</span>}
              {(() => {
                const seg = typeBases.find((t) => t.base === shown.typeBase)?.segment ?? "";
                return seg ? (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${seg === "consumer" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>{seg === "consumer" ? "End consumer" : "Reseller"}</span>
                ) : null;
              })()}
            </div>
          )}
        </section>

        {/* Contact */}
        <section className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
          <SectionTitle hint={editing ? "one per line" : undefined}>Contact</SectionTitle>
          {editing && draft ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Contact person"><input className={inputClass} value={draft.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} /></Field>
              <Field label="Designation"><input className={inputClass} value={draft.designation} onChange={(e) => set("designation", e.target.value)} /></Field>
              <Field label="Phone numbers" hint="One per line — normalised on save"><textarea rows={2} className={inputClass} value={draft.phones} onChange={(e) => set("phones", e.target.value)} /></Field>
              <Field label="Email addresses" hint="One per line"><textarea rows={2} className={inputClass} value={draft.emails} onChange={(e) => set("emails", e.target.value)} /></Field>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Contact person</p>
                <ReadOnlyValue>{[shown.contact, shown.designation].filter(Boolean).join(" · ")}</ReadOnlyValue>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Phone</p>
                {shown.phones.length ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {shown.phones.map((p) => (
                      <a key={p} href={telHref(p)} className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">{formatPhone(p)}</a>
                    ))}
                  </div>
                ) : <ReadOnlyValue />}
              </div>
              <div className="sm:col-span-2">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Email</p>
                {shown.emails.length ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {shown.emails.map((m) => (
                      <a key={m} href={`mailto:${m}`} className="break-all text-sm text-zinc-900 dark:text-zinc-100 hover:underline">{m}</a>
                    ))}
                  </div>
                ) : <ReadOnlyValue />}
              </div>
            </div>
          )}
        </section>

        {/* Location */}
        <section className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
          <SectionTitle hint="Region reassignment is manager-only">Location</SectionTitle>
          {editing && draft ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Region" hint={canManage ? undefined : "Sales-head / MIS only"}>
                <select className={inputClass} value={draft.region} disabled={!canManage} onChange={(e) => set("region", e.target.value)}>
                  <option value="">Unmapped</option>
                  {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Sub-area"><input className={inputClass} value={draft.subArea} disabled={!canManage} onChange={(e) => set("subArea", e.target.value)} /></Field>
              <Field label="State"><input className={inputClass} value={draft.state} disabled={!canManage} onChange={(e) => set("state", e.target.value)} /></Field>
              <Field label="Pincode"><input className={inputClass} value={draft.pincode} onChange={(e) => set("pincode", e.target.value)} /></Field>
              <Field label="City (verified)" hint={detail?.cityZoho ? `Zoho says: ${detail.cityZoho}` : undefined}>
                <input className={inputClass} value={draft.cityVerified} onChange={(e) => set("cityVerified", e.target.value)} />
              </Field>
              <Field label="GSTIN"><input className={inputClass} value={draft.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} /></Field>
              <Field label="Billing address" className="sm:col-span-2">
                <textarea rows={3} className={inputClass} value={draft.billingAddress} onChange={(e) => set("billingAddress", e.target.value)} />
              </Field>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Region / zone</p>
                <ReadOnlyValue>{[regionLabel(shown.region), shown.zone, shown.subArea].filter(Boolean).join(" · ")}</ReadOnlyValue>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">City / state / pincode</p>
                <ReadOnlyValue>{[shown.city, shown.state, shown.pincode].filter(Boolean).join(" · ")}</ReadOnlyValue>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">GSTIN</p>
                <ReadOnlyValue>{shown.gstin || "Not on file"}</ReadOnlyValue>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">City source</p>
                <ReadOnlyValue>{[shown.citySource, shown.locationBasis].filter(Boolean).join(" · ") || "—"}</ReadOnlyValue>
              </div>
              <div className="sm:col-span-2">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Billing address</p>
                <p className="whitespace-pre-line break-words text-sm text-zinc-900 dark:text-zinc-100">{shown.billingAddress || "—"}</p>
              </div>
            </div>
          )}
        </section>

        {/* Pipeline */}
        <section>
          <SectionTitle>Pipeline history</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Estimates</p>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{shown.estCount}</p>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500">{shown.lastEstimateDate ? `last ${formatDate(shown.lastEstimateDate)}` : "never quoted"}</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Sales orders</p>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{shown.soCount}</p>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500">{shown.lastSalesOrderDate ? `last ${formatDate(shown.lastSalesOrderDate)}` : "never ordered"}</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Pipeline · owner</p>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{shown.pipeline || "—"}</p>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-500">{shown.owner ? `Owner code ${shown.owner}` : "No owner on file"}</p>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-zinc-400 dark:text-zinc-500">
            {countHint(shown.estCount, "estimate", shown.lastEstimateDate)} · {countHint(shown.soCount, "sales order", shown.lastSalesOrderDate)}
          </p>
        </section>

        {/* Duplicates */}
        {shown.duplicateGroup && (
          <section>
            <SectionTitle hint={shown.duplicateAction || undefined}>Duplicate review</SectionTitle>
            <div className="rounded-[var(--radius-control)] border border-zinc-200 dark:border-zinc-800 bg-[var(--surface-soft)] px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={shown.duplicateConfidence === "High" ? "rose" : shown.duplicateConfidence === "Medium" ? "amber" : "zinc"} label={shown.duplicateConfidence || "Unrated"} />
                <Pill tone={shown.duplicateReview === "open" ? "indigo" : "emerald"} label={REVIEW_LABELS[shown.duplicateReview ?? "open"]} />
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Group {shown.duplicateGroup}{shown.duplicateAction ? ` · ${shown.duplicateAction}` : ""}</span>
              </div>
              {canEdit && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button type="button" disabled={reviewBusy} onClick={() => void review("keep-master")}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
                    Keep this master
                  </button>
                  <button type="button" disabled={reviewBusy} onClick={() => void review("ignored")}
                    className="rounded-[var(--radius-control)] border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 disabled:opacity-50">
                    Ignore group
                  </button>
                  <button type="button" disabled={reviewBusy} onClick={() => void review("open")}
                    className="rounded-[var(--radius-control)] border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 disabled:opacity-50">
                    Reopen
                  </button>
                </div>
              )}
              {detail?.reviewedBy && (
                <p className="mt-2 text-[10px] text-zinc-400 dark:text-zinc-500">Reviewed by {detail.reviewedBy}{detail.reviewedAt ? ` · ${formatDate(detail.reviewedAt)}` : ""}</p>
              )}
            </div>
          </section>
        )}

        {/* Notes */}
        <section>
          <SectionTitle hint={editing ? "Saved with the record" : undefined}>Notes</SectionTitle>
          {editing && draft ? (
            <textarea rows={3} className={inputClass} value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Corrections, call context, anything the next person should know…" />
          ) : (
            <p className="whitespace-pre-line break-words rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60 text-sm text-zinc-900 dark:text-zinc-100">
              {shown.notes || <span className="text-zinc-400 dark:text-zinc-500">No notes yet.</span>}
            </p>
          )}
        </section>

        {/* Danger zone — sales-head only. Pipeline rows are refused server-side. */}
        {canDelete && detail && (
          <section className="rounded-2xl border border-rose-500/30 bg-white px-4 py-3 shadow-sm dark:border-rose-500/40 dark:bg-zinc-900/60">
            <SectionTitle hint="Permanent">Danger zone</SectionTitle>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Delete this client forever. Blocked while any estimate or sales order exists — set Inactive instead.
              </p>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="shrink-0 rounded-lg border border-rose-300 px-3 py-1.5 text-[11px] font-semibold text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-400 dark:hover:bg-rose-500/10"
              >
                Delete client
              </button>
            </div>
          </section>
        )}

        <ConfirmDialog
          open={confirmDelete}
          title="Delete this client?"
          message={
            <span>
              <strong className="text-zinc-900 dark:text-white">{detail?.name || shown.name}</strong>
              {" "}will be removed from the Customer Master permanently. This cannot be undone.
            </span>
          }
          confirmLabel="Delete forever"
          busy={deleteBusy}
          onConfirm={() => void remove()}
          onCancel={() => { if (!deleteBusy) setConfirmDelete(false); }}
        />

        <p className="border-t border-zinc-200 dark:border-zinc-800 pt-3 text-[10px] text-zinc-400 dark:text-zinc-500">
          {shown.updatedAt ? `Record last updated ${formatDate(shown.updatedAt.slice(0, 10))}` : "Record from the Zoho customer master extract"}
          {shown.typeBase ? ` · Type: ${shown.typeBase}${shown.typeTag ? ` (${shown.typeTag})` : ""}` : ""}
        </p>
      </div>
    </Drawer>
  );
}
