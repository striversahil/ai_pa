export interface Agent {
  id: string;
  name: string;
  initials: string;
  color: string;
  status: string;
  /** Roster email (when the backend serves it) — used to match the
   *  signed-in user to their own agent row. */
  email?: string | null;
}

export interface Activity {
  id: string;
  type: 'creation' | 'assignment' | 'status_change' | 'update';
  text: string;
  timestamp: string;
  agentId?: string;
}

export interface EnquiryRequirement {
  text: string;
  imageUrl?: string;
}

/** One purchasable line item (manual entry in the modal; AI split kept off). */
export interface EnquiryMedia {
  type: 'image' | 'video' | 'pdf';
  url: string;
  name?: string;
}

export interface EnquiryItemRate {
  vendor: string;
  rate: number;
  /** Procurement-entered discount % the vendor offers (0-100). Info-only,
   *  shown to Management alongside the rate. */
  discountPercent?: number;
  /** Per-quote vendor description (address/contact/terms). */
  description?: string;
  /** Procurement note intended for the sales team — only the selected vendor's
   *  salesNote is forwarded to sales with the final rate (founder can edit it
   *  before finalizing). */
  salesNote?: string;
  /** Management-shared alternate: shown to sales as a visible option beside
   *  the decided rate. The finalRate stays the quoted default. */
  sharedWithSales?: boolean;
  /** Per-quote sales final for a shared alternate (item margin % applied to
   *  this quote). Shown to sales as the alternate's price. */
  sharedFinalRate?: number;
  /** False when this quote's spec differs from the item spec. */
  specSame?: boolean;
  /** The differing spec, logged when specSame is false. */
  specDiff?: string;
  /** Per-vendor reference attachments (photos/drawings/PDFs backing THIS
   *  quote). The selected vendor's refs forward to sales with the final rate. */
  references?: EnquiryMedia[];
  /** Server-set on the management-chosen quote for non-privileged readers
   *  (locates the selected quote without exposing the vendor name). */
  selected?: boolean;
  /** ISO instant the quote was logged (older rows lack it). */
  quotedAt?: string;
}

export interface EnquiryItem {
  name: string;
  qty: string;
  spec: string;
  /** Client's own wording for this line (AI intake); shown under the
   *  canonical name so sales can see what was actually asked for. */
  verbatim?: string;
  media?: EnquiryMedia[];
  /** Vendor rates collected by Procurement. */
  rates?: EnquiryItemRate[];
  /** Management decision: chosen vendor + markup + finalized rate. */
  selectedVendor?: string;
  /** Index into `rates` of the management-chosen quote — disambiguates
   *  duplicate vendor names (same vendor, two makes). */
  selectedRateIdx?: number;
  markup?: number;
  finalRate?: number;
  /** Management-decided discount % to pass to customer (0-100). Applied
   *  on the vendor rate before markup: discountedBase = rate*(1-discount/100). */
  finalDiscountPercent?: number;
  /** ISO instant the item was finalized. */
  finalizedAt?: string;
  /** Procurement spec dispute: present = spec flagged incorrect, awaiting a
   *  sales spec edit (which auto-clears it). Held out of Management meanwhile. */
  specIssue?: string;
  specFlaggedAt?: string;
  /** Rate availability (sales-marked): true = rate already available, the item
   *  skips the procurement→management loop. False/absent = rate unavailable. */
  rateAvailable?: boolean;
  /** Not available: procurement requests, management approves (shared text) → sales sees badge. */
  notAvailable?: boolean;
  notAvailableReason?: string;
  notAvailableAt?: string;
  /** Procurement → management request: “material not available” awaiting approval. */
  notAvailableRequested?: string;
  notAvailableRequestedAt?: string;
  /** Management-internal handling: true = management sources this item's
   *  rates itself; the procurement queue skips it. Management-only flag. */
  internalRates?: boolean;
  internalRatesAt?: string;
  /** Management → procurement request: present = management asked for (more)
   *  vendor rates (incorrect quote / different vendor needed). Cleared when
   *  procurement adds or edits a rate. */
  ratesRequested?: string;
  ratesRequestedAt?: string;
  /** Sales → procurement alternate request (non-blocking): free text like
   *  "client wants ABB make" entered via "Request alternate option".
   *  Needs NO management approval — procurement quotes it as a new rate row
   *  (which clears it). Sales may withdraw anytime. */
  variationRequest?: string;
  variationRequestedAt?: string;
  /** Common attachment for the merged info/alternate request. */
  variationRequestMedia?: EnquiryMedia[];
  threadResolved?: boolean;
  threadResolvedBy?: 'sales' | 'procurement' | 'management';
  threadResolvedAt?: string;
  /** Back-and-forth loop trail (server-authored): flags, remarks, fixes,
   *  requests — oldest first. Visible in procurement. */
  thread?: FlagThreadEntry[];
  /** AI bulk intake: true = raw "Add via AI" item awaiting the GH intake
   *  action, which replaces it with vision-split items. */
  aiPending?: boolean;
  /** Sales-negotiated target: client-side expected price + optional note.
   *  Procurement sees it as the negotiation target, management beside rates. */
  expectedRate?: number;
  expectedNote?: string;
  /** KYP grounding: canonical product inferred by Call-2 lookup. */
  kypItem?: string;
  /** Category inferred by Call-2 lookup (mirrors backend `category`). */
  category?: string;
  /** Per-item spec completeness vs KYP required_attributes. */
  kypMissing?: string[];
  kypComplete?: boolean;
}

export interface FlagThreadEntry {
  by: 'sales' | 'procurement' | 'management';
  kind: 'flag' | 'remark' | 'fix' | 'request' | 'quoted';
  text: string;
  at: string;
  media?: EnquiryMedia[];
}

// Queue predicates live in @/enquiry/queue (single frontend source of truth,
// mirroring the backend `modules/enquiries/queues.ts`). Re-exported here so
// existing `@/types` imports keep working.
export {
  itemNeedsRates,
  isSubmitted,
  itemNeedsDecision,
  hasFreshUnquotedWork,
  hasPendingVariationWork,
  itemHasUnreviewedQuotes,
  isFreshQuotableItem,
  isProcurementPendingEnquiry,
  isProcurementHistoryEnquiry,
  isZohoCancelledStatus,
  isZohoClosedStatus,
  isManagementPendingEnquiry,
  procurementSubmittable,
  isManagementHistoryEnquiry,
} from "@/enquiry/queue";

export interface Enquiry {
  id: string;
  estNumber: string;
  /** Zoho Books org of the linked estimate (BUI + DPG share EST numbers). */
  organizationId?: string;
  /** Daily sequence: Enquiry No {dailyNo} - {DD} {MON} {source}. Auto-assigned,
   *  counter resets every IST day. */
  dailyNo?: number | null;
  /** Enquiry source: TL | AI | Incoming | B2B (default TL). */
  source?: string;
  enquiryNumber?: string;
  sourceLead?: string;
  location?: string;
  clientCompany: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  status: 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
  /** Procurement workflow: '' | rate_pending | rates_received | finalized. */
  rateStatus?: string;
  /** Explicit procurement handoff: ISO instant of "Submit to Management".
   *  Only submitted enquiries enter the management queue. */
  procurementSubmittedAt?: string;
  assignedAgentId: string;
  createdAt: string;
  updatedAt?: string;
  activities: Activity[];
  imageUrls?: string[];
  additionalRequirements?: EnquiryRequirement[];
  /** Manual line items (Item 1..N), shown in both Sales and Procurement views. */
  items?: EnquiryItem[];
  /** Procurement view only: true while the AI secure rewrite is still being
   *  prepared (pieces withheld until ready, client refetches on live event). */
  redactedPending?: boolean;
  /** Sent-revision marker: ISO instant when management reopened a `sent`
   *  enquiry for additional scope. While set, the row loops procurement →
   *  management → sent again. Cleared on the next mark-as-sent. */
  sentRevisionAt?: string;
  /** Live Zoho status for the linked estimate (from Estimate table, 5-min sync).
   *  Enriched by GET /api/enquiries list/single — no extra Zoho read, no AI. */
  zohoStatus?: string | null;
  /** Live Zoho customer name for the linked estimate — used for mismatch chip
   *  against `clientCompany` (loosely normalized). */
  zohoCustomerName?: string | null;
}

export interface Comment {
  id: string;
  enquiryId: string;
  agentId: string;
  content: string;
  createdAt: string;
  parentId: string | null;
  replies?: Comment[];
  imageUrl?: string;
  /** Discussion scope: 'sales' (private) or 'procurement' (shared ops thread). */
  visibility?: 'sales' | 'procurement';
}

export interface StoredData {
  enquiries: Enquiry[];
  comments: Comment[];
  agents: Agent[];
}

export const ENQUIRY_SOURCES = ["TL", "AI", "Incoming", "B2B"] as const;

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Display label shared by Sales, Procurement and Management views:
 *  `Enquiry No 10 - 10 SEP TL` (daily counter, IST creation date, source). */
export function enquiryLabel(e: Pick<Enquiry, "dailyNo" | "createdAt" | "source">): string {
  const no = e.dailyNo === undefined || e.dailyNo === null ? "–" : String(e.dailyNo);
  let dd = "–", mon = "–––";
  const d = new Date(e.createdAt);
  if (!Number.isNaN(d.getTime())) {
    const ist = new Date(d.getTime() + (5 * 60 + 30) * 60 * 1000);
    dd = String(ist.getUTCDate()).padStart(2, "0");
    mon = MON[ist.getUTCMonth()] ?? "–––";
  }
  return `Enquiry No ${no} - ${dd} ${mon} ${e.source || "TL"}`;
}

/** Strict money parse for rate/markup/final inputs. Strips currency symbols,
 *  thousand separators and spaces first (mirrors the backend), so "₹1,200.50"
 *  parses as 1200.50. Still rejects empties (Number('') is 0!), hex,
 *  exponents, negatives and trailing words — margin math must never see junk. */
export function parseMoneyInput(v: string): number | null {
  const s = String(v ?? "").trim().replace(/[₹\s,]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Signed variant for MARGIN % only: net/below-cost rates carry a negative
 *  margin (final below vendor cost). Same junk rejection, leading `-`
 *  accepted. Never use for prices (vendor rate, final ₹, expected) — those
 *  stay non-negative. Mirrors backend strictSignedNum. */
export function parseSignedMoneyInput(v: string): number | null {
  const s = String(v ?? "").trim().replace(/[₹\s,]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Human date chip for history sections: Today / Yesterday / 10 Sep (IST). */
export function historyDateChip(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = (t: number) => new Date(t + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10);
  const dd = day(d.getTime());
  if (dd === day(Date.now())) return "Today";
  if (dd === day(Date.now() - 86400000)) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

// Fully backend-driven (/api/enquiries) — no mock seed data. Agent identity
// resolves from the live roster + session email (see useEnquiryData).
export const INITIAL_ENQUIRIES: Enquiry[] = [];
export const INITIAL_COMMENTS: Comment[] = [];
