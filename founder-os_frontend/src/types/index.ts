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
  /** Per-quote vendor description (address/contact/terms). */
  description?: string;
  /** False when this quote's spec differs from the item spec. */
  specSame?: boolean;
  /** The differing spec, logged when specSame is false. */
  specDiff?: string;
  /** ISO instant the quote was logged (older rows lack it). */
  quotedAt?: string;
}

export interface EnquiryItem {
  name: string;
  qty: string;
  spec: string;
  media?: EnquiryMedia[];
  /** Vendor rates collected by Procurement. */
  rates?: EnquiryItemRate[];
  /** Management decision: chosen vendor + markup + finalized rate. */
  selectedVendor?: string;
  markup?: number;
  finalRate?: number;
  /** ISO instant the item was finalized. */
  finalizedAt?: string;
  /** Procurement spec dispute: present = spec flagged incorrect, awaiting a
   *  sales spec edit (which auto-clears it). Held out of Management meanwhile. */
  specIssue?: string;
  specFlaggedAt?: string;
  /** Rate availability (sales-marked): true = rate already available, the item
   *  skips the procurement→management loop. False/absent = rate unavailable. */
  rateAvailable?: boolean;
  /** Management → procurement request: present = management asked for (more)
   *  vendor rates (incorrect quote / different vendor needed). Cleared when
   *  procurement adds or edits a rate. */
  ratesRequested?: string;
  ratesRequestedAt?: string;
  /** Back-and-forth loop trail (server-authored): flags, remarks, fixes,
   *  requests — oldest first. Visible in procurement. */
  thread?: FlagThreadEntry[];
}

export interface FlagThreadEntry {
  by: 'sales' | 'procurement' | 'management';
  kind: 'flag' | 'remark' | 'fix' | 'request' | 'quoted';
  text: string;
  at: string;
}

/** Loop-eligible for Procurement: rate unavailable and (still unquoted OR
 *  management asked for more quotes). Spec-held items (specIssue) stay
 *  visible via the pending enquiry — the row chip shows their hold state. */
export function itemNeedsRates(it: Pick<EnquiryItem, "rateAvailable" | "rates" | "ratesRequested">): boolean {
  return !it?.rateAvailable && (((it?.rates ?? []).length === 0) || !!it?.ratesRequested);
}

/** Loop-eligible for Management: rate unavailable, quoted, not finalized,
 *  spec undisputed. */
export function itemNeedsDecision(it: Pick<EnquiryItem, "rateAvailable" | "rates" | "finalRate" | "specIssue">): boolean {
  return !it?.rateAvailable
    && ((it?.rates ?? []).length > 0)
    && (it?.finalRate === undefined || it?.finalRate === null)
    && !it?.specIssue;
}

/** Enquiry-level queue predicates — THE single source of truth for all three
 *  dashboards (backend predicates mirror these; keep them in sync).
 *  Pending and history are DISJOINT: an enquiry is either awaiting work or
 *  done, never both. Empty enquiries (no items yet) are sales-only — they
 *  wait on sales to add items, not on procurement. */
export function isProcurementPendingEnquiry(e: Pick<Enquiry, "items">): boolean {
  const items = e.items ?? [];
  return items.some(itemNeedsRates);
}

export function isProcurementHistoryEnquiry(e: Pick<Enquiry, "items">): boolean {
  const items = e.items ?? [];
  return !isProcurementPendingEnquiry(e)
    && items.some((it) => (it.rates ?? []).length > 0 && !it.ratesRequested);
}

export function isManagementPendingEnquiry(e: Pick<Enquiry, "items">): boolean {
  return (e.items ?? []).some(itemNeedsDecision);
}

export function isManagementHistoryEnquiry(e: Pick<Enquiry, "items">): boolean {
  const items = e.items ?? [];
  return !isManagementPendingEnquiry(e)
    && items.some((it) => it.finalRate !== undefined && it.finalRate !== null && !it.specIssue);
}

export interface Enquiry {
  id: string;
  estNumber: string;
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

export const INITIAL_AGENTS: Agent[] = [
  { id: '1', name: 'Alice Vance', initials: 'AV', color: '#6366f1', status: 'active' },
  { id: '2', name: 'Bob Miller', initials: 'BM', color: '#10b981', status: 'active' },
  { id: '3', name: 'Charlie Song', initials: 'CS', color: '#f59e0b', status: 'active' },
  { id: '4', name: 'Diana Prince', initials: 'DP', color: '#f43f5e', status: 'active' },
];

// Legacy mock seed data removed — the enquiry tracker is fully backend-driven
// (/api/enquiries). INITIAL_AGENTS above is only a dev/fallback roster.
export const INITIAL_ENQUIRIES: Enquiry[] = [];
export const INITIAL_COMMENTS: Comment[] = [];
