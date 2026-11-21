// enquiry-threads/store.ts — D1 persistence only (no access rules here; the
// service filters by channel before anything leaves the Worker).
import { enquiryLabelText } from '../enquiries/types';
import type { EnquiryThread, ThreadChannel, ThreadMessage, ThreadStatus } from './types';

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

const inList = (n: number) => Array.from({ length: n }, () => '?').join(',');

export async function listThreadsForEnquiry(db: D1, enquiryId: string, channels: ThreadChannel[]): Promise<EnquiryThread[]> {
  const res = await db
    .prepare(`SELECT * FROM EnquiryThread WHERE enquiryId = ? AND channel IN (${inList(channels.length)}) ORDER BY createdAt ASC`)
    .bind(enquiryId, ...channels).all();
  return ((res?.results ?? []) as any[]).map(rowToThread);
}

/** Inbox: newest activity first, joined with the enquiry label. */
export async function listInbox(db: D1, channels: ThreadChannel[], status: ThreadStatus, limit = 200): Promise<EnquiryThread[]> {
  const res = await db
    .prepare(
      `SELECT t.*, e.dailyNo AS dailyNo, e.createdAt AS eCreatedAt, e.source AS source
         FROM EnquiryThread t LEFT JOIN Enquiry e ON e.id = t.enquiryId
        WHERE t.channel IN (${inList(channels.length)}) AND t.status = ?
        ORDER BY t.updatedAt DESC LIMIT ?`,
    )
    .bind(...channels, status, Math.min(500, Math.max(1, limit))).all();
  return ((res?.results ?? []) as any[]).map(rowToThread);
}

/** Open-thread counts per enquiry for the given channels (list badges). */
export async function countOpenByEnquiry(db: D1, channels: ThreadChannel[]): Promise<Array<{ enquiryId: string; open: number; resolved: number }>> {
  const res = await db
    .prepare(
      `SELECT enquiryId, SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved
         FROM EnquiryThread WHERE channel IN (${inList(channels.length)}) GROUP BY enquiryId`,
    )
    .bind(...channels).all();
  return ((res?.results ?? []) as any[]).map((r) => ({ enquiryId: String(r.enquiryId), open: Number(r.open) || 0, resolved: Number(r.resolved) || 0 }));
}

export async function getThread(db: D1, id: string): Promise<EnquiryThread | null> {
  const r = await db.prepare('SELECT * FROM EnquiryThread WHERE id = ?').bind(id).first();
  return r ? rowToThread(r) : null;
}

/** The internal child forwarded from a sales thread (one per source thread —
 *  a re-forward appends the delta instead of opening a duplicate). */
export async function findChildThread(db: D1, parentThreadId: string): Promise<EnquiryThread | null> {
  const r = await db
    .prepare("SELECT * FROM EnquiryThread WHERE parentThreadId = ? AND channel = 'internal' ORDER BY createdAt ASC LIMIT 1")
    .bind(parentThreadId).first();
  return r ? rowToThread(r) : null;
}

/** Item name snapshot without loading the (multi-MB) items blob. */
export async function readItemName(db: D1, enquiryId: string, itemIndex: number): Promise<{ exists: boolean; name: string }> {
  const r = await db
    .prepare(`SELECT id, json_extract(items, '$[' || CAST(? AS INTEGER) || '].name') AS name FROM Enquiry WHERE id = ?`)
    .bind(Math.max(0, Math.floor(itemIndex)), enquiryId).first();
  return { exists: !!r, name: String(r?.name ?? '') };
}

export async function insertThread(db: D1, t: EnquiryThread): Promise<void> {
  await db
    .prepare(
      `INSERT INTO EnquiryThread (id, enquiryId, itemIndex, itemName, channel, status, openedBy, waitingOn, parentThreadId, messages, createdAt, updatedAt, resolvedAt, resolvedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(t.id, t.enquiryId, t.itemIndex, t.itemName, t.channel, t.status, t.openedBy, t.waitingOn, t.parentThreadId,
      JSON.stringify(t.messages), t.createdAt, t.updatedAt, t.resolvedAt, t.resolvedBy)
    .run();
}

export async function saveThreadState(db: D1, t: EnquiryThread): Promise<void> {
  await db
    .prepare('UPDATE EnquiryThread SET status = ?, waitingOn = ?, messages = ?, updatedAt = ?, resolvedAt = ?, resolvedBy = ? WHERE id = ?')
    .bind(t.status, t.waitingOn, JSON.stringify(t.messages), t.updatedAt, t.resolvedAt, t.resolvedBy, t.id)
    .run();
}
