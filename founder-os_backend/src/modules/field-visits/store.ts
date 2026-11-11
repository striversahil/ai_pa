// store.ts — Field Staff persistence (raw D1, Worker-safe).
// Tables: FieldVisit / FieldMillVisit / FieldExpense / FieldFollowup.
// No Prisma relations — joins are manual so the D1 shim stays thin.

type Db = D1Database;

const MILL_COLS = [
  'millName', 'keyContact', 'designation', 'phone', 'rollerPlantNos',
  'attaChakkiNos', 'chakkiSize', 'runningTime', 'products', 'millAgeYrs',
  'machineBrand', 'requirement',
];

function bool(v: unknown): number {
  return v === true || v === 1 || v === '1' ? 1 : 0;
}

export async function listFieldStaff(db: Db): Promise<any[]> {
  const res: any = await db.prepare(
    `SELECT id, name, region, type FROM Telecaller WHERE type = 'field_staff' AND (deleted IS NULL OR deleted = 0) ORDER BY name`,
  ).all();
  return (res as any)?.results ?? [];
}

export async function resolveFieldStaffRow(db: Db, id: string): Promise<any | null> {
  const row: any = await db.prepare(
    `SELECT id, name, region, type, deleted, absentSince FROM Telecaller WHERE id = ? LIMIT 1`,
  ).bind(id).first();
  if (!row) return null;
  if (row.deleted) return null;
  if (String(row.type ?? '') !== 'field_staff') return null;
  return row;
}

export async function listVisits(db: Db, from: string, to: string, staffId: string | null): Promise<any[]> {
  let sql = `SELECT * FROM FieldVisit WHERE day >= ? AND day <= ?`;
  const args: any[] = [from, to];
  if (staffId) {
    sql += ` AND telecallerId = ?`;
    args.push(staffId);
  }
  // Open visits first so the active location always sits on top, then
  // recent day → last (recent to last), newest check-in first.
  sql += ` ORDER BY CASE WHEN checkOutAt = '' THEN 0 ELSE 1 END, day DESC, checkInAt DESC LIMIT 300`;
  const res: any = await db.prepare(sql).bind(...args).all();
  return (res as any)?.results ?? [];
}

export async function getVisit(db: Db, id: string): Promise<any | null> {
  return db.prepare('SELECT * FROM FieldVisit WHERE id = ? LIMIT 1').bind(id).first();
}

export async function createVisit(db: Db, args: {
  telecallerId: string; day: string; city: string; address: string;
  lat: number | null; lng: number | null; note: string;
  createdBy: string; createdByName: string;
}): Promise<any> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  // Automated location tracking is discontinued (founder decision): never
  // persist GPS — check-in is a manual city/address log. Columns stay so old
  // rows keep their values; new rows store NULL / ''.
  await db.prepare(
    `INSERT INTO FieldVisit(id, telecallerId, day, city, address, lat, lng, note, checkInAt, lastPingAt, checkOutAt, createdBy, createdByName, createdAt, updatedAt)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, args.telecallerId, args.day, args.city.slice(0, 200), args.address.slice(0, 500),
    null, null, args.note.slice(0, 1000), now, '', '',
    args.createdBy, args.createdByName.slice(0, 200), now, now,
  ).run();
  return getVisit(db, id);
}

// Retired with automated tracking — kept so old callers fail closed.
// The worker route now answers 410 before reaching here.
export async function pingVisit(_db: Db, _id: string, _lat: number | null, _lng: number | null): Promise<boolean> {
  return false;
}

export async function checkoutVisit(db: Db, id: string): Promise<boolean> {
  const now = new Date().toISOString();
  const meta: any = await db.prepare(
    `UPDATE FieldVisit SET checkOutAt = ?, updatedAt = ? WHERE id = ? AND checkOutAt = ''`,
  ).bind(now, now, id).run();
  return ((meta as any)?.meta?.changes ?? 0) > 0;
}

export async function listMills(db: Db, visitIds: string[]): Promise<any[]> {
  if (visitIds.length === 0) return [];
  const ph = visitIds.map(() => '?').join(',');
  const res: any = await db.prepare(
    `SELECT * FROM FieldMillVisit WHERE visitId IN (${ph}) ORDER BY createdAt DESC`,
  ).bind(...visitIds).all();
  return (res as any)?.results ?? [];
}

export async function getMill(db: Db, id: string): Promise<any | null> {
  return db.prepare('SELECT * FROM FieldMillVisit WHERE id = ? LIMIT 1').bind(id).first();
}

// Sales-head delete (double-confirmed in UI): remove the mill + its
// follow-ups. The auto-created enquiry is deliberately KEPT as the audit
// trail — enquiryId simply goes orphan.
export async function deleteMill(db: Db, id: string): Promise<boolean> {
  await db.prepare(`DELETE FROM FieldFollowup WHERE millVisitId = ?`).bind(id).run().catch(() => null);
  const meta: any = await db.prepare(`DELETE FROM FieldMillVisit WHERE id = ?`).bind(id).run();
  return ((meta as any)?.meta?.changes ?? 0) > 0;
}

// Sales-head delete (double-confirmed in UI): remove the visit + its mills,
// expenses and follow-ups. Auto-created enquiries are KEPT (audit trail).
export async function deleteVisit(db: Db, id: string): Promise<boolean> {
  const mills: any = await db.prepare(`SELECT id FROM FieldMillVisit WHERE visitId = ?`).bind(id).all().catch(() => null);
  const millIds: string[] = (((mills as any)?.results ?? []) as any[]).map((m: any) => String(m.id));
  if (millIds.length > 0) {
    const ph = millIds.map(() => '?').join(',');
    await db.prepare(`DELETE FROM FieldFollowup WHERE millVisitId IN (${ph})`).bind(...millIds).run().catch(() => null);
  }
  await db.prepare(`DELETE FROM FieldMillVisit WHERE visitId = ?`).bind(id).run().catch(() => null);
  await db.prepare(`DELETE FROM FieldExpense WHERE visitId = ?`).bind(id).run().catch(() => null);
  await db.prepare(`DELETE FROM FieldFollowup WHERE visitId = ?`).bind(id).run().catch(() => null);
  const meta: any = await db.prepare(`DELETE FROM FieldVisit WHERE id = ?`).bind(id).run();
  return ((meta as any)?.meta?.changes ?? 0) > 0;
}

export async function createMill(db: Db, args: {
  visitId: string; fields: Record<string, string>;
  isNewSuggested: boolean; matchMasterId: string; matchMasterName: string;
  enquiryId: string; followUpNeeded: boolean;
  createdBy: string; createdByName: string;
}): Promise<any> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const f = (k: string) => String(args.fields[k] ?? '').slice(0, 500);
  await db.prepare(
    `INSERT INTO FieldMillVisit(id, visitId, millName, keyContact, designation, phone, rollerPlantNos, attaChakkiNos, chakkiSize, runningTime, products, millAgeYrs, machineBrand, requirement, isNewSuggested, isNewManual, matchMasterId, matchMasterName, enquiryId, followUpNeeded, createdBy, createdByName, createdAt, updatedAt)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, args.visitId, f('millName').slice(0, 200), f('keyContact'), f('designation'), f('phone'),
    f('rollerPlantNos'), f('attaChakkiNos'), f('chakkiSize'), f('runningTime'),
    f('products'), f('millAgeYrs'), f('machineBrand'), String(args.fields.requirement ?? '').slice(0, 2000),
    bool(args.isNewSuggested), null, args.matchMasterId.slice(0, 64), args.matchMasterName.slice(0, 200),
    args.enquiryId.slice(0, 64), bool(args.followUpNeeded),
    args.createdBy, args.createdByName.slice(0, 200), now, now,
  ).run();
  return db.prepare('SELECT * FROM FieldMillVisit WHERE id = ? LIMIT 1').bind(id).first();
}

export async function setMillNewFlag(db: Db, id: string, isNew: boolean | null): Promise<boolean> {
  const now = new Date().toISOString();
  const meta: any = await db.prepare(
    `UPDATE FieldMillVisit SET isNewManual = ?, updatedAt = ? WHERE id = ?`,
  ).bind(isNew === null ? null : bool(isNew), now, id).run();
  return ((meta as any)?.meta?.changes ?? 0) > 0;
}

export async function setMillFollowup(db: Db, id: string, needed: boolean): Promise<boolean> {
  const now = new Date().toISOString();
  const meta: any = await db.prepare(
    `UPDATE FieldMillVisit SET followUpNeeded = ?, updatedAt = ? WHERE id = ?`,
  ).bind(bool(needed), now, id).run();
  return ((meta as any)?.meta?.changes ?? 0) > 0;
}

export async function listExpenses(db: Db, visitIds: string[], opts?: { from?: string; to?: string; staffId?: string | null }): Promise<any[]> {
  // Day-range mode (global expense calendar): visitIds empty + from/to set.
  if ((!visitIds || visitIds.length === 0) && opts?.from && opts?.to) {
    let sql = `SELECT * FROM FieldExpense WHERE day >= ? AND day <= ?`;
    const args: any[] = [opts.from, opts.to];
    if (opts.staffId) { sql += ` AND staffId = ?`; args.push(opts.staffId); }
    sql += ` ORDER BY day DESC, createdAt DESC LIMIT 500`;
    try {
      const res: any = await db.prepare(sql).bind(...args).all();
      return (res as any)?.results ?? [];
    } catch {
      // Pre-0122 DBs lack day/staffId — fall back to visit-joined rows.
      return [];
    }
  }
  if (!visitIds || visitIds.length === 0) return [];
  const ph = visitIds.map(() => '?').join(',');
  const res: any = await db.prepare(
    `SELECT * FROM FieldExpense WHERE visitId IN (${ph}) ORDER BY createdAt`,
  ).bind(...visitIds).all();
  return (res as any)?.results ?? [];
}

export async function createExpense(db: Db, args: {
  visitId?: string; day?: string; staffId?: string;
  amount: number; description: string; createdBy: string; createdByName: string;
}): Promise<any> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let visitId = String(args.visitId ?? '');
  let day = String(args.day ?? '').slice(0, 10);
  let staffId = String(args.staffId ?? '').trim();
  // Compat: visit-bound writes inherit day/staff from the parent visit.
  if (visitId && (!day || !staffId)) {
    try {
      const v: any = await getVisit(db, visitId);
      if (v) {
        if (!day) day = String((v as any).day ?? '');
        if (!staffId) staffId = String((v as any).telecallerId ?? '');
      }
    } catch { /* leave as-is */ }
  }
  if (!day) day = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  await db.prepare(
    `INSERT INTO FieldExpense(id, visitId, day, staffId, amount, description, createdBy, createdByName, createdAt) VALUES(?,?,?,?,?,?,?,?,?)`,
  ).bind(id, visitId, day, staffId, args.amount, args.description.slice(0, 1000), args.createdBy, args.createdByName.slice(0, 200), now).run();
  return db.prepare('SELECT * FROM FieldExpense WHERE id = ? LIMIT 1').bind(id).first();
}

export async function expenseTotal(db: Db, visitId: string): Promise<number> {
  const row: any = await db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM FieldExpense WHERE visitId = ?`,
  ).bind(visitId).first();
  return Number(row?.total ?? 0);
}

export async function listFollowups(db: Db, visitIds: string[] | null, status: string | null, opts?: { from?: string; to?: string; staffId?: string | null }): Promise<any[]> {
  // Day-range mode (global follow-up queue): filter by stored day + staff.
  if ((!visitIds || visitIds.length === 0) && opts?.from && opts?.to) {
    let sql = `SELECT * FROM FieldFollowup`;
    const args: any[] = [];
    const wh: string[] = [`day >= ?`, `day <= ?`];
    args.push(opts.from, opts.to);
    if (opts.staffId) { wh.push(`staffId = ?`); args.push(opts.staffId); }
    if (status) { wh.push(`status = ?`); args.push(status); }
    sql += ` WHERE ` + wh.join(' AND ');
    sql += ` ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, dueDate, createdAt DESC LIMIT 300`;
    try {
      const res: any = await db.prepare(sql).bind(...args).all();
      return (res as any)?.results ?? [];
    } catch {
      return [];
    }
  }
  let sql = `SELECT * FROM FieldFollowup`;
  const args: any[] = [];
  const wh: string[] = [];
  if (visitIds && visitIds.length > 0) {
    wh.push(`visitId IN (${visitIds.map(() => '?').join(',')})`);
    args.push(...visitIds);
  }
  if (status) {
    wh.push(`status = ?`);
    args.push(status);
  }
  if (wh.length > 0) sql += ` WHERE ` + wh.join(' AND ');
  sql += ` ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, dueDate, createdAt DESC LIMIT 300`;
  const res: any = await db.prepare(sql).bind(...args).all();
  return (res as any)?.results ?? [];
}

export async function createFollowup(db: Db, args: {
  visitId?: string; day?: string; staffId?: string;
  millVisitId: string; dueDate: string; note: string; owner: string;
  createdBy: string; createdByName: string;
}): Promise<any> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let visitId = String(args.visitId ?? '');
  let day = String(args.day ?? '').slice(0, 10);
  let staffId = String(args.staffId ?? '').trim();
  if (visitId && (!day || !staffId)) {
    try {
      const v: any = await getVisit(db, visitId);
      if (v) {
        if (!day) day = String((v as any).day ?? '');
        if (!staffId) staffId = String((v as any).telecallerId ?? '');
      }
    } catch { /* leave as-is */ }
  }
  // Mill-linked global rows inherit staff from the mill's visit when possible.
  if ((!staffId || !day) && args.millVisitId) {
    try {
      const m: any = await getMill(db, String(args.millVisitId));
      const mv: any = (m as any)?.visitId ? await getVisit(db, String((m as any).visitId)) : null;
      if (mv) {
        if (!day) day = String((mv as any).day ?? day);
        if (!staffId) staffId = String((mv as any).telecallerId ?? staffId);
      }
    } catch { /* leave as-is */ }
  }
  if (!day) day = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  await db.prepare(
    `INSERT INTO FieldFollowup(id, visitId, day, staffId, millVisitId, dueDate, note, owner, status, createdBy, createdByName, createdAt, updatedAt)
     VALUES(?,?,?,?,?,?,?,?,'open',?,?,?,?)`,
  ).bind(
    id, visitId, day, staffId, args.millVisitId.slice(0, 64), args.dueDate.slice(0, 20),
    args.note.slice(0, 1000), args.owner.slice(0, 200),
    args.createdBy, args.createdByName.slice(0, 200), now, now,
  ).run();
  return db.prepare('SELECT * FROM FieldFollowup WHERE id = ? LIMIT 1').bind(id).first();
}

export async function setFollowupStatus(db: Db, id: string, status: string): Promise<boolean> {
  const now = new Date().toISOString();
  const meta: any = await db.prepare(
    `UPDATE FieldFollowup SET status = ?, updatedAt = ? WHERE id = ?`,
  ).bind(status, now, id).run();
  return ((meta as any)?.meta?.changes ?? 0) > 0;
}

/** Un-starring a mill cancels its open follow-up rows (date-first toggle). */
export async function cancelOpenFollowupsForMill(db: Db, millId: string): Promise<number> {
  const now = new Date().toISOString();
  const meta: any = await db.prepare(
    `UPDATE FieldFollowup SET status = 'cancelled', updatedAt = ? WHERE millVisitId = ? AND status = 'open'`,
  ).bind(now, String(millId ?? '')).run().catch(() => null);
  return Number((meta as any)?.meta?.changes ?? 0);
}
