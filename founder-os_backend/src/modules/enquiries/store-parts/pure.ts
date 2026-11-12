// Extracted verbatim from store.ts by scripts/refactor/split-module.mjs.
// store.ts re-exports everything public here, so existing imports keep working.
import { normalizeEnquirySource } from "../types";
import type { Enquiry, EnquiryComment } from "../types";
import { parseRequirements, parseItems, normalizeVisibility, isoOrUndefined, normalizeQty, parseItemMedia, parseItemRates, rateIdxOrUndefined, signedNumOrUndefined, numOrUndefined, parseDiscountPercent, composeSearchText } from "../parse";
import { migrateItemLoops, parseLoopRecords } from "../loops";

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export function mapEnquiry(row: any): Enquiry | null {
  if (!row) return null;
  return {
    id: row.id,
    estNumber: row.estNumber ?? "",
    organizationId: String((row as any)?.organizationId ?? ""),
    dailyNo: row.dailyNo === undefined || row.dailyNo === null ? null : Number(row.dailyNo),
    source: row.source ?? "TL",
    enquiryNumber: row.enquiryNumber ?? "",
    sourceLead: row.sourceLead ?? "",
    location: row.location ?? "",
    clientCompany: row.clientCompany,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    rateStatus: (row as any).rateStatus ?? "",
    procurementSubmittedAt: String((row as any).procurementSubmittedAt ?? ""),
    sentRevisionAt: String((row as any).sentRevisionAt ?? ""),
    assignedAgentId: String(row.assignedAgentId ?? ""),
    fieldStaffId: String((row as any).fieldStaffId ?? ""),
    loggedByAgentId: String((row as any).loggedByAgentId ?? ""),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    imageUrls: row.imageUrls ? JSON.parse(row.imageUrls) : [],
    activities: row.activities ? JSON.parse(row.activities) : [],
    additionalRequirements: parseRequirements(row.additionalRequirements),
    items: parseItems(row.items ?? null),
  };
}

export function mapComment(row: any): EnquiryComment | null {
  if (!row) return null;
  return {
    id: row.id,
    enquiryId: row.enquiryId,
    agentId: Number(row.agentId) || 0,
    content: row.content,
    createdAt: row.createdAt,
    parentId: row.parentId ?? null,
    imageUrl: row.imageUrl ?? undefined,
    visibility: normalizeVisibility((row as any).visibility),
  };
}

// D1 does not accept `undefined` bind values — coerce optional fields to ""
// (empty means "not filled", which the LLM extraction later populates).
export function sanitize(e: any): Enquiry {
  const str = (v: any) => (v === undefined || v === null ? "" : String(v));
  const out: Enquiry = {
    ...e,
    estNumber: str(e.estNumber),
    organizationId: str((e as any).organizationId),
    source: normalizeEnquirySource((e as any).source),
    dailyNo: (e as any).dailyNo === undefined || (e as any).dailyNo === null ? null : Number((e as any).dailyNo),
    enquiryNumber: str(e.enquiryNumber),
    sourceLead: str(e.sourceLead),
    location: str(e.location),
    clientCompany: str(e.clientCompany),
    contactName: str(e.contactName),
    contactEmail: str(e.contactEmail),
    contactPhone: str(e.contactPhone),
    title: str(e.title),
    description: str(e.description),
    priority: str(e.priority),
    status: str(e.status),
    rateStatus: str((e as any).rateStatus),
    procurementSubmittedAt: isoOrUndefined((e as any).procurementSubmittedAt) ?? "",
    sentRevisionAt: isoOrUndefined((e as any).sentRevisionAt) ?? "",
    assignedAgentId: str(e.assignedAgentId),
    imageUrls: Array.isArray(e.imageUrls) ? e.imageUrls : [],
    activities: Array.isArray(e.activities) ? e.activities : [],
    additionalRequirements: Array.isArray(e.additionalRequirements) ? e.additionalRequirements : [],
    items: Array.isArray((e as any).items)
      ? (e as any).items.map((r: any) => ({
          name: String(r?.name ?? '').slice(0, 300),
          qty: normalizeQty(r?.qty).slice(0, 120),
          spec: String(r?.spec ?? '').slice(0, 2000),
          media: parseItemMedia(r?.media),
          category: r?.category ? String(r.category).slice(0, 120) : undefined,
          verbatim: r?.verbatim ? String(r.verbatim).slice(0, 500) : undefined,
          kypItem: r?.kypItem ? String(r.kypItem).slice(0, 120) : undefined,
          kypMissing: Array.isArray(r?.kypMissing) ? r.kypMissing.slice(0, 25).map((s: any) => String(s).slice(0, 500)) : undefined,
          kypComplete: typeof r?.kypComplete === 'boolean' ? r.kypComplete : undefined,
          rates: parseItemRates(r?.rates),
          selectedVendor: r?.selectedVendor ? String(r.selectedVendor).slice(0, 200) : undefined,
          selectedRateIdx: rateIdxOrUndefined(r?.selectedRateIdx),
          markup: signedNumOrUndefined(r?.markup),
          finalRate: numOrUndefined(r?.finalRate),
          finalDiscountPercent: parseDiscountPercent(r?.finalDiscountPercent),
        finalizedAt: isoOrUndefined(r?.finalizedAt),
        rateAvailable: r?.rateAvailable === true,
        notAvailable: (r as any)?.notAvailable === true,
        notAvailableReason: (r as any)?.notAvailableReason ? String((r as any).notAvailableReason).slice(0, 500) : undefined,
        notAvailableAt: isoOrUndefined((r as any)?.notAvailableAt),
        internalRates: r?.internalRates === true,
        internalRatesAt: isoOrUndefined(r?.internalRatesAt),
        // Loops migrate here too (defense in depth — normalizeItemWrites is
        // the primary migration point; sanitize covers direct store writes).
        loops: migrateItemLoops({ ...(r as any), loops: parseLoopRecords((r as any)?.loops) }),
        aiPending: r?.aiPending === true ? true : undefined,
        expectedRate: numOrUndefined(r?.expectedRate),
        expectedNote: r?.expectedNote ? String(r.expectedNote).slice(0, 500) : undefined,
        }))
      : [],
  };
  // Search identity recomposes from the NORMALIZED row on every sanitize, so
  // no write path can leave it stale (renames, new items, vendor quotes all
  // re-index inline — same write, zero extra queries).
  out.searchText = composeSearchText(out);
  return out;
}
