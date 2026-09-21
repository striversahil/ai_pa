// types.ts — enquiry domain types + identity helpers.
//
// Extracted from store.ts (no behavior change). Single home for the row
// shape, line-item shape, comment shape, thread shape, and the daily-number
// / label helpers shared by Sales → Procurement → Management.
export const ENQUIRY_SOURCES = ["TL", "AI", "Incoming", "B2B"] as const;

export function normalizeEnquirySource(v: unknown): string {
  const s = String(v ?? "TL").trim();
  return (ENQUIRY_SOURCES as readonly string[]).includes(s) ? s : "TL";
}

/** IST calendar-day key (YYYY-MM-DD) — the daily counter resets on this. */
export function istDayKey(d: Date = new Date()): string {
  const ist = new Date(d.getTime() + (5 * 60 + 30) * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

const MON3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Display label shared by Sales/Procurement/Management:
 *  `Enquiry No 10 - 10 SEP TL` (daily counter, IST creation date, source). */
export function enquiryLabelText(dailyNo: number | null | undefined, createdAtISO: string, source: string): string {
  const no = dailyNo === undefined || dailyNo === null ? "–" : String(dailyNo);
  let dd = "–", mon = "–––";
  const d = new Date(createdAtISO);
  if (!Number.isNaN(d.getTime())) {
    const ist = new Date(d.getTime() + (5 * 60 + 30) * 60 * 1000);
    dd = String(ist.getUTCDate()).padStart(2, "0");
    mon = MON3[ist.getUTCMonth()] ?? "–––";
  }
  return `Enquiry No ${no} - ${dd} ${mon} ${source || "TL"}`;
}

/** Next daily sequence number: max dailyNo already assigned today (IST) + 1. */
export function nextDailyNo(existing: Array<{ createdAt?: string; dailyNo?: number | null }>, now: Date = new Date()): number {
  const today = istDayKey(now);
  let max = 0;
  for (const e of existing) {
    if (!e?.createdAt) continue;
    const dt = new Date(e.createdAt);
    if (Number.isNaN(dt.getTime()) || istDayKey(dt) !== today) continue;
    const n = Number((e as any).dailyNo ?? 0);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export interface EnquiryRequirement {
  text: string;
  imageUrl?: string;
}

/** One purchasable line item AI-split from the unstructured description. */
export interface EnquiryMedia {
  type: 'image' | 'video' | 'pdf';
  url: string;
  name?: string;
}

export interface EnquiryItemRate {
  vendor: string;
  rate: number;
  discountPercent?: number;
  description?: string;
  /** Only the selected vendor's salesNote is forwarded to sales. */
  salesNote?: string;
  sharedWithSales?: boolean;
  sharedFinalRate?: number;
  specSame?: boolean;
  specDiff?: string;
  references?: EnquiryMedia[];
  quotedAt?: string;
}

export interface EnquiryItem {
  name: string;
  qty: string;
  spec: string;
  media: EnquiryMedia[];
  category?: string;
  verbatim?: string;
  rates?: EnquiryItemRate[];
  selectedVendor?: string;
  selectedRateIdx?: number;
  markup?: number;
  finalRate?: number;
  finalDiscountPercent?: number;
  finalizedAt?: string;
  specIssue?: string;
  specFlaggedAt?: string;
  rateAvailable?: boolean;
  notAvailable?: boolean;
  notAvailableReason?: string;
  notAvailableAt?: string;
  notAvailableRequested?: string;
  notAvailableRequestedAt?: string;
  internalRates?: boolean;
  internalRatesAt?: string;
  ratesRequested?: string;
  ratesRequestedAt?: string;
  variationRequest?: string;
  variationRequestedAt?: string;
  /** Common attachment for the variation/info request: sales example ↔ procurement fulfillment (merged). */
  variationRequestMedia?: EnquiryMedia[];
  thread?: FlagThreadEntry[];
  threadResolved?: boolean;
  threadResolvedBy?: FlagThreadBy;
  threadResolvedAt?: string;
  aiPending?: boolean;
  expectedRate?: number;
  expectedNote?: string;
  /** KYP grounding: canonical product name inferred by Call-2 lookup (verbatim preserved in `name`/`verbatim`). */
  kypItem?: string;
  /** Per-item spec completeness against KYP required_attributes. */
  kypMissing?: string[];
  kypComplete?: boolean;
}

export type FlagThreadBy = 'sales' | 'procurement' | 'management';
export type FlagThreadKind = 'flag' | 'remark' | 'fix' | 'request' | 'quoted';

export interface FlagThreadEntry {
  by: FlagThreadBy;
  kind: FlagThreadKind;
  text: string;
  at: string;
  media?: EnquiryMedia[];
}

export interface Enquiry {
  id: string;
  estNumber: string;
  dailyNo: number | null;
  source: string;
  enquiryNumber: string;
  sourceLead: string;
  location: string;
  clientCompany: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  /** Procurement workflow stage: '' | rate_pending | rates_received | finalized | sent. */
  rateStatus: string;
  /** Explicit procurement handoff: ISO instant of "Submit to Management". */
  procurementSubmittedAt: string;
  assignedAgentId: string;
  createdAt: string;
  updatedAt: string;
  imageUrls: string[];
  activities: EnquiryActivity[];
  additionalRequirements: EnquiryRequirement[];
  items: EnquiryItem[];
}

export interface EnquiryActivity {
  id: string;
  type: "creation" | "assignment" | "status_change";
  text: string;
  timestamp: string;
  agentId?: number;
}

export type CommentVisibility = 'sales' | 'procurement';

export interface EnquiryComment {
  id: string;
  enquiryId: string;
  agentId: number;
  content: string;
  createdAt: string;
  parentId: string | null;
  imageUrl?: string;
  visibility?: CommentVisibility;
}

export interface EnquiryStore {
  listEnquiries(): Promise<Enquiry[]>;
  listEnquiriesPaged(offset: number, limit: number): Promise<{ rows: Enquiry[]; total: number }>;
  listCommentsFor(enquiryIds: string[]): Promise<EnquiryComment[]>;
  allocateDailyNo(now?: Date): Promise<number>;
  getEnquiry(id: string): Promise<Enquiry | null>;
  createEnquiry(data: Omit<Enquiry, "id" | "createdAt" | "updatedAt">): Promise<Enquiry>;
  updateEnquiry(id: string, updates: Partial<Omit<Enquiry, "id" | "createdAt">>): Promise<Enquiry | null>;
  deleteEnquiry(id: string): Promise<void>;
  listComments(enquiryId: string): Promise<EnquiryComment[]>;
  addComment(data: Omit<EnquiryComment, "id" | "createdAt">): Promise<EnquiryComment>;
  listAllComments(): Promise<EnquiryComment[]>;
}
