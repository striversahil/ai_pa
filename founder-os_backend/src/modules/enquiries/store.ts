// ── Enquiries store: persistence-agnostic sales pipeline storage ────────────
// Two implementations: D1 (Cloudflare Worker) and Prisma (Express/Postgres).
// The Worker build imports ONLY this file; the Prisma implementation lives in
// store-prisma.ts so the Prisma client never enters the Worker bundle.

export interface EnquiryRequirement {
  text: string;
  imageUrl?: string;
}

export interface Enquiry {
  id: string;
  estNumber: string;
  clientCompany: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  assignedAgentId: string;
  createdAt: string;
  updatedAt: string;
  imageUrls: string[];
  activities: EnquiryActivity[];
  additionalRequirements: EnquiryRequirement[];
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
    clientCompany: row.clientCompany,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    assignedAgentId: String(row.assignedAgentId ?? ""),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    imageUrls: row.imageUrls ? JSON.parse(row.imageUrls) : [],
    activities: row.activities ? JSON.parse(row.activities) : [],
    additionalRequirements: parseRequirements(row.additionalRequirements),
  };
}

export function parseRequirements(raw: string | null): EnquiryRequirement[] {
  if (!raw) return [];
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
    clientCompany: str(e.clientCompany),
    contactName: str(e.contactName),
    contactEmail: str(e.contactEmail),
    contactPhone: str(e.contactPhone),
    title: str(e.title),
    description: str(e.description),
    priority: str(e.priority),
    status: str(e.status),
    assignedAgentId: str(e.assignedAgentId),
    imageUrls: Array.isArray(e.imageUrls) ? e.imageUrls : [],
    activities: Array.isArray(e.activities) ? e.activities : [],
    additionalRequirements: Array.isArray(e.additionalRequirements) ? e.additionalRequirements : [],
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
        "INSERT INTO Enquiry (id, estNumber, clientCompany, contactName, contactEmail, contactPhone, title, description, priority, status, assignedAgentId, createdAt, updatedAt, imageUrls, activities, additionalRequirements) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        e.id, e.estNumber, e.clientCompany, e.contactName, e.contactEmail, e.contactPhone, e.title, e.description,
        e.priority, e.status, e.assignedAgentId, e.createdAt, e.updatedAt,
        JSON.stringify(e.imageUrls ?? []), JSON.stringify(e.activities ?? []), JSON.stringify(e.additionalRequirements ?? []),
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
        "UPDATE Enquiry SET estNumber=?, clientCompany=?, contactName=?, contactEmail=?, contactPhone=?, title=?, description=?, priority=?, status=?, assignedAgentId=?, updatedAt=?, imageUrls=?, activities=?, additionalRequirements=? WHERE id=?",
      )
      .bind(
        merged.estNumber, merged.clientCompany, merged.contactName, merged.contactEmail, merged.contactPhone, merged.title,
        merged.description, merged.priority, merged.status, merged.assignedAgentId,
        merged.updatedAt, JSON.stringify(merged.imageUrls ?? []), JSON.stringify(merged.activities ?? []),
        JSON.stringify(merged.additionalRequirements ?? []), id,
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