// store.ts — Sales Objections persistence (raw D1, Worker-safe).
// Tables: SalesObjection / SalesObjectionReply. No Prisma relations —
// replies are joined manually so the D1 shim stays thin.

import type { ObjectionCategory } from './types';

type Db = D1Database;

export interface ObjectionRow {
  id: string;
  estNumber: string;
  clientName: string;
  category: ObjectionCategory;
  detail: string;
  status: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export async function listObjections(db: Db, opts: { status?: string; category?: string; q?: string }): Promise<any[]> {
  const conds: string[] = [];
  const args: any[] = [];
  const status = String(opts.status ?? '').trim();
  if (status === 'open' || status === 'resolved') {
    conds.push('o.status = ?');
    args.push(status);
  }
  const category = String(opts.category ?? '').trim();
  if (category) {
    conds.push('o.category = ?');
    args.push(category);
  }
  const q = String(opts.q ?? '').trim();
  if (q) {
    conds.push('(o.estNumber LIKE ? OR o.clientName LIKE ? OR o.detail LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const res: any = await db.prepare(
    `SELECT o.* FROM SalesObjection o ${where} ORDER BY o.updatedAt DESC, o.createdAt DESC LIMIT 300`,
  ).bind(...args).all();
  const rows: any[] = (res as any)?.results ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((r: any) => String(r.id));
  const placeholders = ids.map(() => '?').join(',');
  const rr: any = await db.prepare(
    `SELECT * FROM SalesObjectionReply WHERE objectionId IN (${placeholders}) ORDER BY createdAt ASC`,
  ).bind(...ids).all();
  const byObjection = new Map<string, any[]>();
  for (const r of ((rr as any)?.results ?? []) as any[]) {
    const k = String((r as any).objectionId);
    if (!byObjection.has(k)) byObjection.set(k, []);
    byObjection.get(k)!.push(r);
  }
  return rows.map((r: any) => ({ ...r, replies: byObjection.get(String(r.id)) ?? [] }));
}

export async function getObjection(db: Db, id: string): Promise<any | null> {
  const row: any = await db.prepare('SELECT * FROM SalesObjection WHERE id = ? LIMIT 1').bind(id).first();
  if (!row) return null;
  const rr: any = await db.prepare(
    'SELECT * FROM SalesObjectionReply WHERE objectionId = ? ORDER BY createdAt ASC',
  ).bind(id).all();
  return { ...row, replies: ((rr as any)?.results ?? []) as any[] };
}

export async function createObjection(db: Db, args: {
  estNumber: string; clientName: string; category: ObjectionCategory; detail: string;
  createdBy: string; createdByName: string;
}): Promise<any> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO SalesObjection(id, estNumber, clientName, category, detail, status, createdBy, createdByName, createdAt, updatedAt)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, args.estNumber, args.clientName, args.category, args.detail, 'open',
    args.createdBy, args.createdByName.slice(0, 200), now, now,
  ).run();
  return getObjection(db, id);
}

export async function addReply(db: Db, args: {
  objectionId: string; text: string; createdBy: string; createdByName: string;
}): Promise<any | null> {
  const existing: any = await db.prepare('SELECT id FROM SalesObjection WHERE id = ? LIMIT 1').bind(args.objectionId).first();
  if (!existing) return null;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO SalesObjectionReply(id, objectionId, text, createdBy, createdByName, createdAt)
     VALUES(?,?,?,?,?,?)`,
  ).bind(id, args.objectionId, args.text, args.createdBy, args.createdByName.slice(0, 200), now).run();
  await db.prepare('UPDATE SalesObjection SET updatedAt = ? WHERE id = ?').bind(now, args.objectionId).run();
  return getObjection(db, args.objectionId);
}

export async function setObjectionStatus(db: Db, id: string, status: 'open' | 'resolved'): Promise<any | null> {
  const now = new Date().toISOString();
  const meta: any = await db.prepare('UPDATE SalesObjection SET status = ?, updatedAt = ? WHERE id = ?')
    .bind(status, now, id).run();
  if (((meta as any)?.meta?.changes ?? 0) <= 0) return null;
  return getObjection(db, id);
}
