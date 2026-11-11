// enquiry/normalize.ts — API → UI row normalization for enquiries/comments.
//
// Extracted from hooks/useEnquiryData.ts (no behavior change). Pure mappers
// shared by all three dashboards (sales tracker, procurement queue,
// management review) so server-shape drift is fixed in one place.
import type { Enquiry, Comment, Activity, EnquiryItem } from '../types';
import { parseLoopRecords } from './loops';

export function toComment(raw: any): Comment {
  return {
    id: raw.id,
    enquiryId: raw.enquiryId,
    agentId: String(raw.agentId ?? ''),
    content: raw.content,
    createdAt: raw.createdAt,
    parentId: raw.parentId ?? null,
    imageUrl: raw.imageUrl || undefined,
    visibility: raw.visibility === 'procurement' ? 'procurement' : 'sales',
  };
}

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
}

export function toEnquiry(raw: any): Enquiry {
  const imageUrls = Array.isArray(raw.imageUrls) ? raw.imageUrls : [];
  const activities = Array.isArray(raw.activities) ? raw.activities : [];
  const additionalRequirements = Array.isArray(raw.additionalRequirements)
    ? raw.additionalRequirements.map((r: any) => (typeof r === "string" ? { text: r } : { text: String(r?.text ?? ""), imageUrl: r?.imageUrl || undefined }))
    : [];
  const items = Array.isArray(raw.items)
    ? raw.items.map((r: any) => ({
        name: String(r?.name ?? ""),
        qty: String(r?.qty ?? ""),
        spec: String(r?.spec ?? ""),
        category: r?.category ? String(r.category) : undefined,
        verbatim: r?.verbatim ? String(r.verbatim) : undefined,
        media: Array.isArray(r?.media)
          ? r.media
              .map((m: any) => ({
                type: m?.type === "video" ? "video" : m?.type === "pdf" ? "pdf" : "image",
                url: String(m?.url ?? ""),
                name: m?.name ? String(m.name) : undefined,
              }))
              .filter((m: any) => m.url.length > 0)
          : [],
        rates: Array.isArray(r?.rates)
          ? r.rates
              .map((q: any) => ({
                vendor: String(q?.vendor ?? ""),
                rate: Number(q?.rate ?? NaN),
                size: q?.size ? String(q.size).slice(0, 120) : undefined,
                discountPercent: q?.discountPercent !== undefined && q?.discountPercent !== null && q?.discountPercent !== "" ? Number(q.discountPercent) : undefined,
                description: q?.description ? String(q.description) : undefined,
                salesNote: q?.salesNote ? String(q.salesNote) : undefined,
                sharedWithSales: q?.sharedWithSales === true ? true : undefined,
                sharedFinalRate: q?.sharedFinalRate !== undefined && q?.sharedFinalRate !== null && q?.sharedFinalRate !== "" && Number.isFinite(Number(q.sharedFinalRate)) && Number(q.sharedFinalRate) >= 0 ? Number(q.sharedFinalRate) : undefined,
                specSame: q?.specSame === false ? false : true,
                specDiff: q?.specSame === false && q?.specDiff ? String(q.specDiff) : undefined,
                quotedAt: q?.quotedAt ? String(q.quotedAt) : undefined,
                selected: q?.selected === true,
                references: Array.isArray(q?.references)
                  ? q.references
                      .map((m: any) => ({
                        type: m?.type === "video" ? "video" : m?.type === "pdf" ? "pdf" : "image",
                        url: String(m?.url ?? ""),
                        name: m?.name ? String(m.name) : undefined,
                      }))
                      .filter((m: any) => m.url.length > 0)
                  : [],
              }))
              .filter((q: any) => q.vendor.trim() && Number.isFinite(q.rate))
          : [],
        selectedVendor: r?.selectedVendor ? String(r.selectedVendor) : undefined,
        selectedRateIdx: Number.isInteger(Number(r?.selectedRateIdx)) && Number(r?.selectedRateIdx) >= 0 ? Number(r.selectedRateIdx) : undefined,
        markup: r?.markup !== undefined && r?.markup !== null && r?.markup !== "" ? Number(r.markup) : undefined,
        finalRate: r?.finalRate !== undefined && r?.finalRate !== null && r?.finalRate !== "" ? Number(r.finalRate) : undefined,
        finalDiscountPercent: (r as any)?.finalDiscountPercent !== undefined && (r as any)?.finalDiscountPercent !== null && (r as any)?.finalDiscountPercent !== "" ? Number((r as any).finalDiscountPercent) : undefined,
        finalizedAt: r?.finalizedAt ? String(r.finalizedAt) : undefined,
        rateAvailable: r?.rateAvailable === true,
        notAvailable: (r as any)?.notAvailable === true,
        notAvailableReason: (r as any)?.notAvailableReason ? String((r as any).notAvailableReason) : undefined,
        notAvailableAt: (r as any)?.notAvailableAt ? String((r as any).notAvailableAt) : undefined,
        internalRates: r?.internalRates === true,
        internalRatesAt: r?.internalRatesAt ? String(r.internalRatesAt) : undefined,
        loops: parseLoopRecords((r as any)?.loops),
        aiPending: r?.aiPending === true ? true : undefined,
        expectedRate: r?.expectedRate !== undefined && r?.expectedRate !== null && r?.expectedRate !== "" ? Number(r.expectedRate) : undefined,
        expectedNote: r?.expectedNote ? String(r.expectedNote) : undefined,
      })).filter((r: any) => r.name.trim() || r.qty.trim() || r.spec.trim() || r.media.length > 0 || (r.rates ?? []).length > 0)
    : [];
  return {
    id: raw.id,
    estNumber: raw.estNumber || '',
    organizationId: (raw as any).organizationId ? String((raw as any).organizationId) : undefined,
    dailyNo: raw.dailyNo === undefined || raw.dailyNo === null ? null : Number(raw.dailyNo),
    source: raw.source || 'TL',
    enquiryNumber: raw.enquiryNumber || '',
    sourceLead: raw.sourceLead || '',
    location: raw.location || '',
    clientCompany: raw.clientCompany,
    contactName: raw.contactName,
    contactEmail: raw.contactEmail,
    contactPhone: raw.contactPhone,
    title: raw.title,
    description: raw.description,
    priority: raw.priority || 'medium',
    status: raw.status || 'new',
    rateStatus: raw.rateStatus || '',
    procurementSubmittedAt: raw.procurementSubmittedAt ? String(raw.procurementSubmittedAt) : undefined,
    sentRevisionAt: (raw as any).sentRevisionAt ? String((raw as any).sentRevisionAt) : undefined,
    assignedAgentId: String(raw.assignedAgentId ?? ''),
    fieldStaffId: String((raw as any).fieldStaffId ?? ''),
    loggedByAgentId: String((raw as any).loggedByAgentId ?? ''),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt || raw.createdAt,
    activities,
    imageUrls,
    additionalRequirements,
    items,
    zohoStatus: (raw as any).zohoStatus ? String((raw as any).zohoStatus) : null,
    zohoCustomerName: (raw as any).zohoCustomerName ? String((raw as any).zohoCustomerName) : null,
  } as any;
}

export type { Enquiry, Comment, Activity, EnquiryItem };
