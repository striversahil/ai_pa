// ── Enquiries store: persistence-agnostic sales pipeline storage ────────────
// Two implementations: D1 (Cloudflare Worker) and Prisma (Express/Postgres).
// The Worker build imports ONLY this file; the Prisma implementation lives in
// store-prisma.ts so the Prisma client never enters the Worker bundle.

/** Allowed enquiry sources (New Enquiry form selector, default TL). */
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
 *  `Enquiry No 10 - 10 SEP TL` (daily counter, IST creation date, source).
 *  New enquiries are titled with this (the Title form field is removed). */
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

/** One purchasable line item AI-split from the unstructured description
 *  (Specifications & Scope). Rendered as Item 1..N in both Sales and
 *  Procurement views; sales can edit/delete/reorder manually. */
export interface EnquiryMedia {
  type: 'image' | 'video' | 'pdf';
  url: string;
  name?: string;
}

export interface EnquiryItemRate {
  vendor: string;
  rate: number;
  /** Vendor description / address / contact as entered by Procurement. */
  description?: string;
  /** False when this vendor's spec differs from the item spec (see specDiff). */
  specSame?: boolean;
  /** The differing spec, logged when specSame is false. */
  specDiff?: string;
  /** IST instant the quote was logged (stamped on add; older rows lack it). */
  quotedAt?: string;
}

export interface EnquiryItem {
  name: string;
  qty: string;
  spec: string;
  media: EnquiryMedia[];
  /** Vendor rates collected by Procurement (multiple vendors per item). */
  rates?: EnquiryItemRate[];
  /** Management decision: chosen vendor + markup + finalized rate. */
  selectedVendor?: string;
  markup?: number;
  finalRate?: number;
  /** IST instant the item was finalized (stamped on finalize). */
  finalizedAt?: string;
  /** Procurement spec dispute: present = spec flagged incorrect, awaiting a
   *  sales spec edit (which auto-clears it). Flagged items are held out of
   *  Management until resolved. */
  specIssue?: string;
  specFlaggedAt?: string;
  /** Rate availability (sales-marked): true = rate already available, the item
   *  skips the procurement→management loop. False/absent = rate unavailable,
   *  flows to Procurement for quoting and then Management for finalize. */
  rateAvailable?: boolean;
}

/** ISO instant passthrough (quotedAt/finalizedAt) — invalid values dropped. */
export const isoOrUndefined = (v: unknown): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

/** ~10MB binary per attachment (base64 inflates ~4/3). Enforced client-side
 *  and re-checked server-side in routes pick(). */
export const MAX_ITEM_MEDIA_URL_CHARS = 15_000_000;
export const MAX_ITEM_MEDIA_COUNT = 10;

export function parseItemMedia(raw: unknown): EnquiryMedia[] {
  if (!Array.isArray(raw)) return [];
  const shaped: EnquiryMedia[] = raw.map((m: any) => ({
    type: (m?.type === 'video' ? 'video' : m?.type === 'pdf' ? 'pdf' : 'image') as EnquiryMedia['type'],
    url: String(m?.url ?? ''),
    name: m?.name ? String(m.name).slice(0, 200) : undefined,
  }));
  return shaped
    .filter((m) => m.url.length > 0 && m.url.length <= MAX_ITEM_MEDIA_URL_CHARS)
    .slice(0, MAX_ITEM_MEDIA_COUNT);
}

export function parseItemRates(raw: unknown): EnquiryItemRate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r: any) => {
      const specSame = r?.specSame === false ? false : true;
      return {
        vendor: String(r?.vendor ?? '').slice(0, 200),
        rate: strictNum(r?.rate) ?? NaN,
        description: r?.description ? String(r.description).slice(0, 2000) : undefined,
        specSame,
        specDiff: !specSame && r?.specDiff ? String(r.specDiff).slice(0, 2000) : undefined,
        quotedAt: isoOrUndefined(r?.quotedAt),
      };
    })
    .filter((r) => r.vendor.trim().length > 0 && Number.isFinite(r.rate) && r.rate >= 0)
    .slice(0, 50);
}

/** Strict numeric for money fields (rates/markup/finals — margin math runs on
 *  these): plain digits with an optional decimal part only. Rejects empties
 *  (Number('') is 0!), whitespace, hex, exponents and trailing words. */
export const strictNum = (v: unknown): number | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export const numOrUndefined = (v: unknown): number | undefined => strictNum(v);

export interface Enquiry {
  id: string;
  estNumber: string;
  /** Daily sequence: Enquiry No {dailyNo} - {DD} {MON} {source}. Auto-assigned
   *  at creation; the counter resets every IST day. */
  dailyNo: number | null;
  /** Enquiry source: TL | AI | Incoming | B2B (default TL). */
  source: string;
  /** Sales-agent lead details (parsed by AI from the first 1–2 comments). */
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
  /** Procurement workflow stage: '' (legacy) | rate_pending | rates_received | finalized. */
  rateStatus: string;
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

export interface EnquiryComment {
  id: string;
  enquiryId: string;
  agentId: number;
  content: string;
  createdAt: string;
  parentId: string | null;
  imageUrl?: string;
}

export interface EnquiryStore {
  listEnquiries(): Promise<Enquiry[]>;
  getEnquiry(id: string): Promise<Enquiry | null>;
  createEnquiry(data: Omit<Enquiry, "id" | "createdAt" | "updatedAt">): Promise<Enquiry>;
  updateEnquiry(id: string, updates: Partial<Omit<Enquiry, "id" | "createdAt">>): Promise<Enquiry | null>;
  deleteEnquiry(id: string): Promise<void>;
  listComments(enquiryId: string): Promise<EnquiryComment[]>;
  addComment(data: Omit<EnquiryComment, "id" | "createdAt">): Promise<EnquiryComment>;
  listAllComments(): Promise<EnquiryComment[]>;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export function mapEnquiry(row: any): Enquiry | null {
  if (!row) return null;
  return {
    id: row.id,
    estNumber: row.estNumber ?? "",
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
    assignedAgentId: String(row.assignedAgentId ?? ""),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    imageUrls: row.imageUrls ? JSON.parse(row.imageUrls) : [],
    activities: row.activities ? JSON.parse(row.activities) : [],
    additionalRequirements: parseRequirements(row.additionalRequirements),
    items: parseItems(row.items ?? null),
  };
}

export function parseItems(raw: string | null): EnquiryItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r: any) => ({
        name: String(r?.name ?? '').slice(0, 300),
        qty: String(r?.qty ?? '').slice(0, 120),
        spec: String(r?.spec ?? '').slice(0, 2000),
        media: parseItemMedia(r?.media),
        rates: parseItemRates(r?.rates),
        selectedVendor: r?.selectedVendor ? String(r.selectedVendor).slice(0, 200) : undefined,
        markup: numOrUndefined(r?.markup),
        finalRate: numOrUndefined(r?.finalRate),
        finalizedAt: isoOrUndefined(r?.finalizedAt),
        specIssue: r?.specIssue ? String(r.specIssue).slice(0, 2000) : undefined,
        specFlaggedAt: isoOrUndefined(r?.specFlaggedAt),
        rateAvailable: r?.rateAvailable === true,
      }))
      .filter((r: EnquiryItem) => r.name.trim() || r.qty.trim() || r.spec.trim() || r.media.length > 0 || (r.rates ?? []).length > 0)
      .slice(0, 100);
  } catch {
    return [];
  }
}

export function parseRequirements(raw: string | null): EnquiryRequirement[] {  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r: any) => (typeof r === "string" ? { text: r } : { text: String(r?.text ?? ""), imageUrl: r?.imageUrl || undefined }))
      .filter((r: EnquiryRequirement) => r.text.trim().length > 0);
  } catch {
    return [];
  }
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
  };
}

// D1 does not accept `undefined` bind values — coerce optional fields to ""
// (empty means "not filled", which the LLM extraction later populates).
export function sanitize(e: any): Enquiry {
  const str = (v: any) => (v === undefined || v === null ? "" : String(v));
  return {
    ...e,
    estNumber: str(e.estNumber),
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
    assignedAgentId: str(e.assignedAgentId),
    imageUrls: Array.isArray(e.imageUrls) ? e.imageUrls : [],
    activities: Array.isArray(e.activities) ? e.activities : [],
    additionalRequirements: Array.isArray(e.additionalRequirements) ? e.additionalRequirements : [],
    items: Array.isArray((e as any).items)
      ? (e as any).items.map((r: any) => ({
          name: String(r?.name ?? '').slice(0, 300),
          qty: String(r?.qty ?? '').slice(0, 120),
          spec: String(r?.spec ?? '').slice(0, 2000),
          media: parseItemMedia(r?.media),
          rates: parseItemRates(r?.rates),
          selectedVendor: r?.selectedVendor ? String(r.selectedVendor).slice(0, 200) : undefined,
          markup: numOrUndefined(r?.markup),
          finalRate: numOrUndefined(r?.finalRate),
        finalizedAt: isoOrUndefined(r?.finalizedAt),
        specIssue: r?.specIssue ? String(r.specIssue).slice(0, 2000) : undefined,
        specFlaggedAt: isoOrUndefined(r?.specFlaggedAt),
        rateAvailable: r?.rateAvailable === true,
        }))
      : [],
  };
}

// ── In-memory (dev / fallback) ────────────────────────────────────────────────
class MemoryEnquiryStore implements EnquiryStore {
  enquiries: Enquiry[] = [];
  comments: EnquiryComment[] = [];
  seq = 1;

  async listEnquiries() {
    return [...this.enquiries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getEnquiry(id: string) {
    return this.enquiries.find((e) => e.id === id) ?? null;
  }
  async createEnquiry(data) {
    const now = new Date().toISOString();
    const e: Enquiry = { ...data, id: newId(), createdAt: now, updatedAt: now };
    this.enquiries.push(e);
    return e;
  }
  async updateEnquiry(id, updates) {
    const i = this.enquiries.findIndex((e) => e.id === id);
    if (i === -1) return null;
    this.enquiries[i] = { ...this.enquiries[i], ...updates, updatedAt: new Date().toISOString() };
    return this.enquiries[i];
  }
  async deleteEnquiry(id) {
    this.enquiries = this.enquiries.filter((e) => e.id !== id);
    this.comments = this.comments.filter((c) => c.enquiryId !== id);
  }
  async listComments(enquiryId) {
    return this.comments.filter((c) => c.enquiryId === enquiryId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async addComment(data) {
    const c: EnquiryComment = { ...data, id: newId(), createdAt: new Date().toISOString() };
    this.comments.push(c);
    return c;
  }
  async listAllComments() {
    return this.comments;
  }
}

// ── D1 (Cloudflare Worker) ───────────────────────────────────────────────────
class D1EnquiryStore implements EnquiryStore {
  constructor(private db: any) {}

  async listEnquiries() {
    const { results } = await this.db.prepare("SELECT * FROM Enquiry ORDER BY createdAt DESC").all();
    return ((results || []) as any[]).map(mapEnquiry).filter(Boolean) as Enquiry[];
  }
  async getEnquiry(id: string) {
    const row = await this.db.prepare("SELECT * FROM Enquiry WHERE id = ?").bind(id).first();
    return mapEnquiry(row);
  }
  async createEnquiry(data) {
    const now = new Date().toISOString();
    const e: Enquiry = sanitize({ ...data, id: newId(), createdAt: now, updatedAt: now });
    await this.db
      .prepare(
        "INSERT INTO Enquiry (id, estNumber, dailyNo, source, enquiryNumber, sourceLead, location, clientCompany, contactName, contactEmail, contactPhone, title, description, priority, status, rateStatus, assignedAgentId, createdAt, updatedAt, imageUrls, activities, additionalRequirements, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        e.id, e.estNumber, e.dailyNo, e.source, e.enquiryNumber, e.sourceLead, e.location, e.clientCompany, e.contactName, e.contactEmail, e.contactPhone, e.title, e.description,
        e.priority, e.status, e.rateStatus, e.assignedAgentId, e.createdAt, e.updatedAt,
        JSON.stringify(e.imageUrls ?? []), JSON.stringify(e.activities ?? []), JSON.stringify(e.additionalRequirements ?? []), JSON.stringify(e.items ?? []),
      )
      .run();
    return e;
  }
  async updateEnquiry(id, updates) {
    const existing = await this.getEnquiry(id);
    if (!existing) return null;
    const merged: Enquiry = sanitize({ ...existing, ...updates, updatedAt: new Date().toISOString() });
    await this.db
      .prepare(
        "UPDATE Enquiry SET estNumber=?, dailyNo=?, source=?, enquiryNumber=?, sourceLead=?, location=?, clientCompany=?, contactName=?, contactEmail=?, contactPhone=?, title=?, description=?, priority=?, status=?, rateStatus=?, assignedAgentId=?, updatedAt=?, imageUrls=?, activities=?, additionalRequirements=?, items=? WHERE id=?",
      )
      .bind(
        merged.estNumber, merged.dailyNo, merged.source, merged.enquiryNumber, merged.sourceLead, merged.location, merged.clientCompany, merged.contactName, merged.contactEmail, merged.contactPhone, merged.title,
        merged.description, merged.priority, merged.status, merged.rateStatus, merged.assignedAgentId,
        merged.updatedAt, JSON.stringify(merged.imageUrls ?? []), JSON.stringify(merged.activities ?? []),
        JSON.stringify(merged.additionalRequirements ?? []), JSON.stringify(merged.items ?? []), id,
      )
      .run();
    return merged;
  }
  async deleteEnquiry(id) {
    await this.db.prepare("DELETE FROM EnquiryComment WHERE enquiryId = ?").bind(id).run();
    await this.db.prepare("DELETE FROM Enquiry WHERE id = ?").bind(id).run();
  }
  async listComments(enquiryId) {
    const { results } = await this.db.prepare("SELECT * FROM EnquiryComment WHERE enquiryId = ? ORDER BY createdAt ASC").bind(enquiryId).all();
    return ((results || []) as any[]).map(mapComment).filter(Boolean) as EnquiryComment[];
  }
  async addComment(data) {
    const c: EnquiryComment = { ...data, id: newId(), createdAt: new Date().toISOString() };
    await this.db
      .prepare("INSERT INTO EnquiryComment (id, enquiryId, agentId, content, createdAt, parentId, imageUrl) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(c.id, c.enquiryId, c.agentId, c.content, c.createdAt, c.parentId, c.imageUrl ?? null)
      .run();
    return c;
  }
  async listAllComments() {
    const { results } = await this.db.prepare("SELECT * FROM EnquiryComment ORDER BY createdAt ASC").all();
    return ((results || []) as any[]).map(mapComment).filter(Boolean) as EnquiryComment[];
  }
}

let cachedMemory: MemoryEnquiryStore | null = null;

export function createEnquiryStore(env: any): EnquiryStore {
  if (env && env.DB && typeof env.DB.prepare === "function") return new D1EnquiryStore(env.DB);
  if (env && env.__prismaEnquiryStore) return env.__prismaEnquiryStore as EnquiryStore;
  if (!cachedMemory) cachedMemory = new MemoryEnquiryStore();
  return cachedMemory;
}