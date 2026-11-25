// enquiry-threads/store.ts — D1 persistence only (no access rules here; the
// service filters by channel before anything leaves the Worker).
import { enquiryLabelText } from '../enquiries/types';
import type { EnquiryThread, ThreadDesk, ThreadMessage, ThreadStatus } from './types';
import { employeeDisplayName } from '../../shared/employee-name';

type D1 = any;

function parseMessages(raw: unknown): ThreadMessage[] {
  try {
    const v = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(v) ? v.filter((m) => m && typeof m === 'object' && typeof m.text === 'string') : [];
  } catch { return []; }
}

function rowToThread(r: any): EnquiryThread {
  const t: EnquiryThread = {
    id: String(r.id), enquiryId: String(r.enquiryId),
    itemIndex: Number(r.itemIndex) || 0, itemName: String(r.itemName ?? ''),
    channel: r.channel === 'internal' ? 'internal' : 'sales',
    category: r.category === 'product_query' || r.category === 'rate_negotiation' ? r.category : null,
    status: r.status === 'resolved' ? 'resolved' : 'open',
    openedBy: r.openedBy, waitingOn: r.waitingOn,
    parentThreadId: r.parentThreadId ? String(r.parentThreadId) : null,
    messages: parseMessages(r.messages),
    createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
    resolvedAt: r.resolvedAt ? String(r.resolvedAt) : null,
    resolvedBy: r.resolvedBy ?? null,
  };
  if (r.eCreatedAt !== undefined) t.enquiryLabel = enquiryLabelText(r.dailyNo ?? null, String(r.eCreatedAt ?? ''), String(r.source ?? ''));
  return t;
}

/** Row-level visibility in SQL — mirror of `pure.canSee` (guard
 *  enquiry-threads). Legacy rows (category NULL) stay management-only on the
 *  sales channel, exactly as before categories existed. Procurement joins a
 *  sales thread ONLY when Sales raised a product query — a management→sales
 *  question stays private (founder rule 2026-11-23). */
function visibility(desk: ThreadDesk, prefix = ''): string {
  if (desk === 'management') return '1 = 1';
  if (desk === 'sales') return `${prefix}channel = 'sales'`;
  return `(${prefix}channel = 'internal' OR (${prefix}channel = 'sales' AND ${prefix}category = 'product_query' AND ${prefix}openedBy = 'sales'))`;
}

export async function listThreadsForEnquiry(db: D1, enquiryId: string, desk: ThreadDesk): Promise<EnquiryThread[]> {
  const res = await db
    .prepare(`SELECT * FROM EnquiryThread WHERE enquiryId = ? AND (${visibility(desk)}) ORDER BY createdAt ASC`)
    .bind(enquiryId).all();
  return ((res?.results ?? []) as any[]).map(rowToThread);
}

/** Inbox: newest activity first, joined with the enquiry label. */
export async function listInbox(db: D1, desk: ThreadDesk, status: ThreadStatus, limit = 200): Promise<EnquiryThread[]> {
  const res = await db
    .prepare(
      `SELECT t.*, e.dailyNo AS dailyNo, e.createdAt AS eCreatedAt, e.source AS source
         FROM EnquiryThread t LEFT JOIN Enquiry e ON e.id = t.enquiryId
        WHERE (${visibility(desk, 't.')}) AND t.status = ?
        ORDER BY t.updatedAt DESC LIMIT ?`,
    )
    .bind(status, Math.min(500, Math.max(1, limit))).all();
  return ((res?.results ?? []) as any[]).map(rowToThread);
}

/** Open-thread counts per enquiry for the desk (list badges). */
export async function countOpenByEnquiry(db: D1, desk: ThreadDesk): Promise<Array<{ enquiryId: string; open: number; resolved: number }>> {
  const res = await db
    .prepare(
      `SELECT enquiryId, SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved
         FROM EnquiryThread WHERE (${visibility(desk)}) GROUP BY enquiryId`,
    )
    .all();
  return ((res?.results ?? []) as any[]).map((r) => ({ enquiryId: String(r.enquiryId), open: Number(r.open) || 0, resolved: Number(r.resolved) || 0 }));
}

export async function getThread(db: D1, id: string): Promise<EnquiryThread | null> {
  const r = await db.prepare('SELECT * FROM EnquiryThread WHERE id = ?').bind(id).first();
  return r ? rowToThread(r) : null;
}

/** The person's display name from the HR register, matched on the login email
 *  (explicit `loginEmail` wins over the contact `email`). Includes the
 *  character-name format; an author must never read as an address. */
export async function readMemberName(db: D1, email: string): Promise<string> {
  const e = String(email ?? '').trim().toLowerCase();
  if (!e) return '';
  try {
    const r: any = await db
      .prepare(
        `SELECT name, characterName, useCharacterName FROM HumanResourcesMember
          WHERE lower(loginEmail) = ? OR lower(email) = ?
          ORDER BY CASE WHEN lower(loginEmail) = ? THEN 0 ELSE 1 END LIMIT 1`,
      )
      .bind(e, e, e).first();
    return employeeDisplayName(r as any);
  } catch { return ''; }
}

/** Item name snapshot without loading the (multi-MB) items blob. */
export async function readItemName(db: D1, enquiryId: string, itemIndex: number): Promise<{ exists: boolean; name: string }> {
  const r = await db
    .prepare(`SELECT id, json_extract(items, '$[' || CAST(? AS INTEGER) || '].name') AS name FROM Enquiry WHERE id = ?`)
    .bind(Math.max(0, Math.floor(itemIndex)), enquiryId).first();
  return { exists: !!r, name: String(r?.name ?? '') };
}

/** Vendor names quoted on one item — used to scrub procurement-authored text
 *  before Sales sees it. Reads only that item's quotes via json_extract, never
 *  the whole blob; fail-open ([] = nothing to scrub, never a broken reply). */
export async function readItemVendors(db: D1, enquiryId: string, itemIndex: number): Promise<string[]> {
  try {
    const i = Math.max(0, Math.floor(itemIndex));
    const r: any = await db
      .prepare(
        `SELECT json_extract(items, '$[' || CAST(? AS INTEGER) || '].rates') AS rates,
                json_extract(items, '$[' || CAST(? AS INTEGER) || '].selectedVendor') AS selected
           FROM Enquiry WHERE id = ?`,
      )
      .bind(i, i, enquiryId).first();
    const out: string[] = [];
    const rates = JSON.parse(String(r?.rates ?? '[]'));
    if (Array.isArray(rates)) for (const q of rates) if (q?.vendor) out.push(String(q.vendor));
    if (r?.selected) out.push(String(r.selected));
    return out;
  } catch { return []; }
}

export async function insertThread(db: D1, t: EnquiryThread): Promise<void> {
  await db
    .prepare(
      `INSERT INTO EnquiryThread (id, enquiryId, itemIndex, itemName, channel, category, status, openedBy, waitingOn, parentThreadId, messages, createdAt, updatedAt, resolvedAt, resolvedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(t.id, t.enquiryId, t.itemIndex, t.itemName, t.channel, t.category ?? null, t.status, t.openedBy, t.waitingOn, t.parentThreadId,
      JSON.stringify(t.messages), t.createdAt, t.updatedAt, t.resolvedAt, t.resolvedBy)
    .run();
}

export async function saveThreadState(db: D1, t: EnquiryThread): Promise<void> {
  await db
    .prepare('UPDATE EnquiryThread SET status = ?, waitingOn = ?, messages = ?, updatedAt = ?, resolvedAt = ?, resolvedBy = ? WHERE id = ?')
    .bind(t.status, t.waitingOn, JSON.stringify(t.messages), t.updatedAt, t.resolvedAt, t.resolvedBy, t.id)
    .run();
}
