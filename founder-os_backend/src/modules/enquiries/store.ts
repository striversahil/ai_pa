// ── Enquiries store: persistence-agnostic sales pipeline storage ────────────
// Two implementations: D1 (Cloudflare Worker) and Prisma (Express/Postgres).
// The Worker build imports ONLY this file; the Prisma implementation lives in
// store-prisma.ts so the Prisma client never enters the Worker bundle.
//
// Slim orchestrator: domain types live in types.ts, pure parsers in parse.ts,
// queue predicates in queues.ts, authz in scopes.ts, redaction in
// redaction.ts. This file keeps ONLY row mapping + sanitize + the Memory/D1
// stores. Re-exports below preserve existing import paths (no caller changes).
import {
  ENQUIRY_SOURCES,
  normalizeEnquirySource,
  istDayKey,
  nextDailyNo,
  enquiryLabelText,
} from "./types";
import type {
  Enquiry,
  EnquiryActivity,
  EnquiryComment,
  EnquiryItem,
  EnquiryMedia,
  EnquiryItemRate,
  EnquiryRequirement,
  CommentVisibility,
  EnquiryStore,
  FlagThreadBy,
  FlagThreadEntry,
} from "./types";
import {
  parseFlagThread,
  normalizeVisibility,
  isoOrUndefined,
  rateIdxOrUndefined,
  normalizeQty,
  parseItemMedia,
  parseItemRates,
  parseDiscountPercent,
  strictNum,
  numOrUndefined,
  parseItems,
  parseRequirements,
} from "./parse";

export {
  ENQUIRY_SOURCES,
  normalizeEnquirySource,
  istDayKey,
  nextDailyNo,
  enquiryLabelText,
  parseFlagThread,
  normalizeVisibility,
  isoOrUndefined,
  rateIdxOrUndefined,
  normalizeQty,
  parseItemMedia,
  parseItemRates,
  parseDiscountPercent,
  strictNum,
  numOrUndefined,
  parseItems,
  parseRequirements,
};
export type {
  Enquiry,
  EnquiryActivity,
  EnquiryComment,
  EnquiryItem,
  EnquiryMedia,
  EnquiryItemRate,
  EnquiryRequirement,
  CommentVisibility,
  EnquiryStore,
  FlagThreadBy,
  FlagThreadEntry,
};
export { MAX_ITEM_MEDIA_URL_CHARS, MAX_ITEM_MEDIA_COUNT } from "./parse";

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
    procurementSubmittedAt: String((row as any).procurementSubmittedAt ?? ""),
    assignedAgentId: String(row.assignedAgentId ?? ""),
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
    procurementSubmittedAt: isoOrUndefined((e as any).procurementSubmittedAt) ?? "",
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
          rates: parseItemRates(r?.rates),
          selectedVendor: r?.selectedVendor ? String(r.selectedVendor).slice(0, 200) : undefined,
          selectedRateIdx: rateIdxOrUndefined(r?.selectedRateIdx),
          markup: numOrUndefined(r?.markup),
          finalRate: numOrUndefined(r?.finalRate),
          finalDiscountPercent: parseDiscountPercent(r?.finalDiscountPercent),
        finalizedAt: isoOrUndefined(r?.finalizedAt),
        specIssue: r?.specIssue ? String(r.specIssue).slice(0, 2000) : undefined,
        specFlaggedAt: isoOrUndefined(r?.specFlaggedAt),
        rateAvailable: r?.rateAvailable === true,
        internalRates: r?.internalRates === true,
        internalRatesAt: isoOrUndefined(r?.internalRatesAt),
        thread: parseFlagThread(r?.thread),
        ratesRequested: r?.ratesRequested ? String(r.ratesRequested).slice(0, 500) : undefined,
        ratesRequestedAt: isoOrUndefined(r?.ratesRequestedAt),
        variationRequest: r?.variationRequest ? String(r.variationRequest).slice(0, 500) : undefined,
        variationRequestedAt: isoOrUndefined(r?.variationRequestedAt),
        aiPending: r?.aiPending === true ? true : undefined,
        expectedRate: numOrUndefined(r?.expectedRate),
        expectedNote: r?.expectedNote ? String(r.expectedNote).slice(0, 500) : undefined,
        }))
      : [],
  };
}

// ── In-memory (dev / fallback) ────────────────────────────────────────────────
class MemoryEnquiryStore implements EnquiryStore {
  enquiries: Enquiry[] = [];
  comments: EnquiryComment[] = [];
  seq = 1;
  private dailyCounters = new Map<string, number>();

  async allocateDailyNo(now: Date = new Date()): Promise<number> {
    const key = istDayKey(now);
    const next = (this.dailyCounters.get(key) ?? 0) + 1;
    this.dailyCounters.set(key, next);
    return next;
  }

  async listEnquiries() {
    return [...this.enquiries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async listEnquiriesPaged(offset: number, limit: number) {
    const all = [...this.enquiries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { rows: all.slice(offset, offset + limit), total: all.length };
  }
  async listCommentsFor(enquiryIds: string[]) {
    const set = new Set(enquiryIds);
    return this.comments.filter((c) => set.has(c.enquiryId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async getEnquiry(id: string) {
    return this.enquiries.find((e) => e.id === id) ?? null;
  }
  async createEnquiry(data: Omit<Enquiry, "id" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    const e: Enquiry = { ...data, id: newId(), createdAt: now, updatedAt: now };
    this.enquiries.push(e);
    return e;
  }
  async updateEnquiry(id: string, updates: Partial<Omit<Enquiry, "id" | "createdAt">>) {
    const i = this.enquiries.findIndex((e) => e.id === id);
    if (i === -1) return null;
    this.enquiries[i] = { ...this.enquiries[i], ...updates, updatedAt: new Date().toISOString() };
    return this.enquiries[i];
  }
  async deleteEnquiry(id: string) {
    this.enquiries = this.enquiries.filter((e) => e.id !== id);
    this.comments = this.comments.filter((c) => c.enquiryId !== id);
  }
  async listComments(enquiryId: string) {
    return this.comments.filter((c) => c.enquiryId === enquiryId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async addComment(data: Omit<EnquiryComment, "id" | "createdAt">) {
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
  async listEnquiriesPaged(offset: number, limit: number) {
    const off = Math.max(0, Math.floor(offset));
    const lim = Math.min(100, Math.max(1, Math.floor(limit)));
    const [page, count] = await Promise.all([
      this.db.prepare("SELECT * FROM Enquiry ORDER BY createdAt DESC LIMIT ? OFFSET ?").bind(lim, off).all(),
      this.db.prepare("SELECT COUNT(*) AS total FROM Enquiry").first(),
    ]);
    return {
      rows: (((page as any).results || []) as any[]).map(mapEnquiry).filter(Boolean) as Enquiry[],
      total: Number((count as any)?.total ?? 0),
    };
  }
  async listCommentsFor(enquiryIds: string[]) {
    if (!enquiryIds.length) return [];
    const placeholders = enquiryIds.map(() => "?").join(",");
    const { results } = await this.db.prepare(
      `SELECT * FROM EnquiryComment WHERE enquiryId IN (${placeholders}) ORDER BY createdAt ASC`,
    ).bind(...enquiryIds).all();
    return ((results || []) as any[]).map(mapComment).filter(Boolean) as EnquiryComment[];
  }
  async allocateDailyNo(now: Date = new Date()): Promise<number> {
    const key = `enquiry:daily:${istDayKey(now)}`;
    const at = new Date().toISOString();
    await this.db.prepare(
      `INSERT INTO Setting(key, value, updatedAt) VALUES(?, '1', ?) ` +
      `ON CONFLICT(key) DO UPDATE SET value = CAST(Setting.value AS INTEGER) + 1, updatedAt = excluded.updatedAt`,
    ).bind(key, at).run();
    const row: any = await this.db.prepare(`SELECT value FROM Setting WHERE key = ?`).bind(key).first();
    const n = Number(row?.value ?? 1);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
    const all = await this.listEnquiries().catch(() => [] as Enquiry[]);
    return nextDailyNo(all, now);
  }
  async getEnquiry(id: string) {
    const row = await this.db.prepare("SELECT * FROM Enquiry WHERE id = ?").bind(id).first();
    return mapEnquiry(row);
  }
  async createEnquiry(data: Omit<Enquiry, "id" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    const e: Enquiry = sanitize({ ...data, id: newId(), createdAt: now, updatedAt: now });
    await this.db
      .prepare(
        "INSERT INTO Enquiry (id, estNumber, dailyNo, source, enquiryNumber, sourceLead, location, clientCompany, contactName, contactEmail, contactPhone, title, description, priority, status, rateStatus, procurementSubmittedAt, assignedAgentId, createdAt, updatedAt, imageUrls, activities, additionalRequirements, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        e.id, e.estNumber, e.dailyNo, e.source, e.enquiryNumber, e.sourceLead, e.location, e.clientCompany, e.contactName, e.contactEmail, e.contactPhone, e.title, e.description,
        e.priority, e.status, e.rateStatus, e.procurementSubmittedAt, e.assignedAgentId, e.createdAt, e.updatedAt,
        JSON.stringify(e.imageUrls ?? []), JSON.stringify(e.activities ?? []), JSON.stringify(e.additionalRequirements ?? []), JSON.stringify(e.items ?? []),
      )
      .run();
    return e;
  }
  async updateEnquiry(id: string, updates: Partial<Omit<Enquiry, "id" | "createdAt">>) {
    const existing = await this.getEnquiry(id);
    if (!existing) return null;
    const merged: Enquiry = sanitize({ ...existing, ...updates, updatedAt: new Date().toISOString() });
    await this.db
      .prepare(
        "UPDATE Enquiry SET estNumber=?, dailyNo=?, source=?, enquiryNumber=?, sourceLead=?, location=?, clientCompany=?, contactName=?, contactEmail=?, contactPhone=?, title=?, description=?, priority=?, status=?, rateStatus=?, procurementSubmittedAt=?, assignedAgentId=?, updatedAt=?, imageUrls=?, activities=?, additionalRequirements=?, items=? WHERE id=?",
      )
      .bind(
        merged.estNumber, merged.dailyNo, merged.source, merged.enquiryNumber, merged.sourceLead, merged.location, merged.clientCompany, merged.contactName, merged.contactEmail, merged.contactPhone, merged.title,
        merged.description, merged.priority, merged.status, merged.rateStatus, merged.procurementSubmittedAt, merged.assignedAgentId,
        merged.updatedAt, JSON.stringify(merged.imageUrls ?? []), JSON.stringify(merged.activities ?? []),
        JSON.stringify(merged.additionalRequirements ?? []), JSON.stringify(merged.items ?? []), id,
      )
      .run();
    return merged;
  }
  async deleteEnquiry(id: string) {
    await this.db.prepare("DELETE FROM EnquiryComment WHERE enquiryId = ?").bind(id).run();
    await this.db.prepare("DELETE FROM Enquiry WHERE id = ?").bind(id).run();
  }
  async listComments(enquiryId: string) {
    const { results } = await this.db.prepare("SELECT * FROM EnquiryComment WHERE enquiryId = ? ORDER BY createdAt ASC").bind(enquiryId).all();
    return ((results || []) as any[]).map(mapComment).filter(Boolean) as EnquiryComment[];
  }
  async addComment(data: Omit<EnquiryComment, "id" | "createdAt">) {
    const c: EnquiryComment = { ...data, visibility: normalizeVisibility((data as any)?.visibility), id: newId(), createdAt: new Date().toISOString() };
    await this.db
      .prepare("INSERT INTO EnquiryComment (id, enquiryId, agentId, content, createdAt, parentId, imageUrl, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(c.id, c.enquiryId, c.agentId, c.content, c.createdAt, c.parentId, c.imageUrl ?? null, c.visibility ?? 'sales')
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
