"use client";

// CustomerDrawer — the full record for one customer, with inline editing for
// appointed editors. Region / sub-area / state stay manager-only (ownership is
// the sales-head's call), matching the server's MANAGER_ONLY_FIELDS.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CustomerPatch, DuplicateReview, MasterCustomer, MasterCustomerDetail } from "@/master-data/types";
import { getMasterCustomer, patchMasterCustomer, setDuplicateReview } from "@/master-data/api";
import {
  REVIEW_LABELS, countHint, duplicateTone, formatDate, formatPhone, initials,
  regionLabel, regionTone, reviewTone, statusTone, telHref,
} from "@/master-data/normalize";
import { Badge } from "@/components/ui";
import {
  Drawer, Field, GhostButton, PrimaryButton, ReadOnlyValue, SectionTitle, inputClass,
} from "./ui";

interface Draft {
  displayName: string;
  companyName: string;
  contactPerson: string;
  designation: string;
  phones: string;
  emails: string;
  gstin: string;
  pincode: string;
  cityVerified: string;
  billingAddress: string;
  status: string;
  notes: string;
  region: string;
  subArea: string;
  state: string;
}

const DRAFT_KEYS: Array<keyof Draft> = [
  "displayName", "companyName", "contactPerson", "designation", "phones", "emails",
  "gstin", "pincode", "cityVerified", "billingAddress", "status", "notes", "region",
  "subArea", "state",
];

const MANAGER_KEYS = new Set<keyof Draft>(["region", "subArea", "state"]);

const REGIONS = ["R1", "R2", "R3", "R4"];

function toDraft(c: MasterCustomerDetail): Draft {
  return {
    displayName: c.name,
    companyName: c.company,
    contactPerson: c.contact,
    designation: c.designation,
    phones: c.phones.join("\n"),
    emails: c.emails.join("\n"),
    gstin: c.gstin,
    pincode: c.pincode,
    cityVerified: c.cityVerified,
    billingAddress: c.billingAddress,
    status: c.status,
    notes: c.notes,
    region: c.region,
    subArea: c.subArea,
    state: c.state,
  };
}

function draftToPatch(draft: Draft, original: Draft, canManage: boolean): CustomerPatch {
  const patch: Record<string, unknown> = {};
  for (const key of DRAFT_KEYS) {
    if (draft[key] === original[key]) continue;
    if (MANAGER_KEYS.has(key) && !canManage) continue;
    if (key === "phones") {
      const list = draft.phones.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
      patch.phones = list;
    } else if (key === "emails") {
      const list = draft.emails.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
      patch.emails = list;
    } else {
      patch[key] = draft[key];
    }
  }
  return patch as CustomerPatch;
}

function ChipRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export default function CustomerDrawer({
  customerId, seed, canEdit, canManage, onClose, onSaved,
}: {
  customerId: string | null;
  seed: MasterCustomer | null;
  canEdit: boolean;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [detail, setDetail] = useState<MasterCustomerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);

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

  return (
    <Drawer
      open={!!customerId}
      onClose={onClose}
      title={
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-brand-indigo)_12%,transparent)] text-xs font-extrabold text-[var(--color-brand-indigo)]">
            {initials(shown.name)}
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-heading text-card-title font-semibold text-[var(--text-primary)]">{shown.name}</h3>
            <p className="mt-0.5 truncate text-caption text-[var(--text-secondary)]">
              {[shown.company && shown.company !== shown.name ? shown.company : "", shown.city, regionLabel(shown.region)]
                .filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      }
      subtitle={
        <ChipRow>
          <Badge tone={statusTone(shown.status)} dot>{shown.status}</Badge>
          <Badge tone={regionTone(shown.region)}>{regionLabel(shown.region)}</Badge>
          {shown.duplicateGroup && <Badge tone={duplicateTone(shown.duplicateConfidence)}>Dup {shown.duplicateGroup}</Badge>}
          <span className="text-[10px] text-[var(--text-tertiary)]">Zoho #{shown.zohoCustomerId}</span>
        </ChipRow>
      }
      footer={
        canEdit ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--text-tertiary)]">
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
          <p className="text-[11px] text-[var(--text-tertiary)]">
            Read-only — only editors appointed by the sales-head can change customer records.
          </p>
        )
      }
    >
      {loading && <p className="animate-pulse text-label text-[var(--text-secondary)]">Loading the full record…</p>}
      {error && <p className="rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] px-3 py-2 text-label text-[var(--color-danger)]">{error}</p>}
      {saveError && <p className="mb-3 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] px-3 py-2 text-label text-[var(--color-danger)]">{saveError}</p>}

      <div className="space-y-5">
        {/* Contact */}
        <section>
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
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">Contact person</p>
                <ReadOnlyValue>{[shown.contact, shown.designation].filter(Boolean).join(" · ")}</ReadOnlyValue>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">Phone</p>
                {shown.phones.length ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {shown.phones.map((p) => (
                      <a key={p} href={telHref(p)} className="text-label font-semibold text-[var(--color-brand-indigo)] hover:underline">{formatPhone(p)}</a>
                    ))}
                  </div>
                ) : <ReadOnlyValue />}
              </div>
              <div className="sm:col-span-2">
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">Email</p>
                {shown.emails.length ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {shown.emails.map((m) => (
                      <a key={m} href={`mailto:${m}`} className="break-all text-label text-[var(--text-primary)] hover:underline">{m}</a>
                    ))}
                  </div>
                ) : <ReadOnlyValue />}
              </div>
            </div>
          )}
        </section>

        {/* Location */}
        <section>
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
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">Region / zone</p>
                <ReadOnlyValue>{[regionLabel(shown.region), shown.zone, shown.subArea].filter(Boolean).join(" · ")}</ReadOnlyValue>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">City / state / pincode</p>
                <ReadOnlyValue>{[shown.city, shown.state, shown.pincode].filter(Boolean).join(" · ")}</ReadOnlyValue>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">GSTIN</p>
                <ReadOnlyValue>{shown.gstin || "Not on file"}</ReadOnlyValue>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">City source</p>
                <ReadOnlyValue>{[shown.citySource, shown.locationBasis].filter(Boolean).join(" · ") || "—"}</ReadOnlyValue>
              </div>
              <div className="sm:col-span-2">
                <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">Billing address</p>
                <p className="whitespace-pre-line break-words text-label text-[var(--text-primary)]">{shown.billingAddress || "—"}</p>
              </div>
            </div>
          )}
        </section>

        {/* Pipeline */}
        <section>
          <SectionTitle>Pipeline history</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[var(--radius-control)] bg-[var(--surface-soft)] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">Estimates</p>
              <p className="text-sm font-semibold text-[var(--text-primary)]">{shown.estCount}</p>
              <p className="text-[10px] text-[var(--text-tertiary)]">{shown.lastEstimateDate ? `last ${formatDate(shown.lastEstimateDate)}` : "never quoted"}</p>
            </div>
            <div className="rounded-[var(--radius-control)] bg-[var(--surface-soft)] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">Sales orders</p>
              <p className="text-sm font-semibold text-[var(--text-primary)]">{shown.soCount}</p>
              <p className="text-[10px] text-[var(--text-tertiary)]">{shown.lastSalesOrderDate ? `last ${formatDate(shown.lastSalesOrderDate)}` : "never ordered"}</p>
            </div>
            <div className="rounded-[var(--radius-control)] bg-[var(--surface-soft)] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">Pipeline · owner</p>
              <p className="text-sm font-semibold text-[var(--text-primary)]">{shown.pipeline || "—"}</p>
              <p className="text-[10px] text-[var(--text-tertiary)]">{shown.owner ? `Owner code ${shown.owner}` : "No owner on file"}</p>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">
            {countHint(shown.estCount, "estimate", shown.lastEstimateDate)} · {countHint(shown.soCount, "sales order", shown.lastSalesOrderDate)}
          </p>
        </section>

        {/* Duplicates */}
        {shown.duplicateGroup && (
          <section>
            <SectionTitle hint={shown.duplicateAction || undefined}>Duplicate review</SectionTitle>
            <div className="rounded-[var(--radius-control)] border border-[var(--border-card)] bg-[var(--surface-soft)] px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={duplicateTone(shown.duplicateConfidence)}>{shown.duplicateConfidence || "Unrated"}</Badge>
                <Badge tone={reviewTone(shown.duplicateReview ?? "open")}>{REVIEW_LABELS[shown.duplicateReview ?? "open"]}</Badge>
                <span className="text-[11px] text-[var(--text-secondary)]">Group {shown.duplicateGroup}{shown.duplicateAction ? ` · ${shown.duplicateAction}` : ""}</span>
              </div>
              {canEdit && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button type="button" disabled={reviewBusy} onClick={() => void review("keep-master")}
                    className="rounded-[var(--radius-control)] bg-[var(--color-brand-indigo)] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
                    Keep this master
                  </button>
                  <button type="button" disabled={reviewBusy} onClick={() => void review("ignored")}
                    className="rounded-[var(--radius-control)] border border-[var(--border-card)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text-secondary)] disabled:opacity-50">
                    Ignore group
                  </button>
                  <button type="button" disabled={reviewBusy} onClick={() => void review("open")}
                    className="rounded-[var(--radius-control)] border border-[var(--border-card)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text-secondary)] disabled:opacity-50">
                    Reopen
                  </button>
                </div>
              )}
              {detail?.reviewedBy && (
                <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">Reviewed by {detail.reviewedBy}{detail.reviewedAt ? ` · ${formatDate(detail.reviewedAt)}` : ""}</p>
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
            <p className="whitespace-pre-line break-words rounded-[var(--radius-control)] bg-[var(--surface-soft)] px-3 py-2 text-label text-[var(--text-primary)]">
              {shown.notes || <span className="text-[var(--text-tertiary)]">No notes yet.</span>}
            </p>
          )}
        </section>

        <p className="border-t border-[var(--border-card)] pt-3 text-[10px] text-[var(--text-tertiary)]">
          {shown.updatedAt ? `Record last updated ${formatDate(shown.updatedAt.slice(0, 10))}` : "Record from the Zoho customer master extract"}
          {shown.typeBase ? ` · Type: ${shown.typeBase}${shown.typeTag ? ` (${shown.typeTag})` : ""}` : ""}
        </p>
      </div>
    </Drawer>
  );
}
