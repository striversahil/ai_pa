// store.ts — persistence for the customer master (D1, raw SQL).
//
// Worker-only module: the master table is a new surface, and Express is frozen
// (founder decision), so there is no Prisma-shim path to maintain. Reads are
// keyset-paginated because D1 caps rows per query; the dashboard payload is
// KV-cached (service.ts), so this cost is paid once per cache window.
import { getD1Database } from '../../shared/prisma-d1';
import type { ImportCustomer, MasterDataAuditEntry, MasterRegion, DuplicateReview } from './types';
import { toRegion } from './parse';

/** D1 binding (null outside the Worker / before initD1). */
export function masterDb(): any {
  return getD1Database();
}

const LIST_COLUMNS = [
  'id', 'zohoCustomerId', 'region', 'zone', 'subArea', 'state', 'pincode',
  'displayName', 'companyName', 'customerType', 'customerTypeBase', 'customerTypeTag',
  'status', 'contactPerson', 'designation', 'phonesJson', 'emailsJson', 'gstin', 'owner',
  'pipelineStage', 'estimateCount', 'lastEstimateDate', 'salesOrderCount', 'lastSalesOrderDate',
  'cityZoho', 'cityVerified', 'duplicateGroup', 'duplicateConfidence', 'suggestedAction',
  'duplicateReview', 'notes',
].join(', ');

const DETAIL_COLUMNS = `${LIST_COLUMNS}, citySource, locationBasis, billingAddress, reviewedBy, reviewedAt, updatedAt`;

/** Every customer row, keyset-paginated on the primary key (D1 row caps). */
export async function listAllCustomers(): Promise<any[]> {
  const db = masterDb();
  if (!db) return [];
  const out: any[] = [];
  let cursor = '';
  for (let page = 0; page < 40; page++) {
    const res = await db
      .prepare(`SELECT ${LIST_COLUMNS} FROM MasterCustomer WHERE id > ? ORDER BY id LIMIT 500`)
      .bind(cursor)
      .all();
    const rows: any[] = res?.results ?? [];
    if (rows.length === 0) break;
    out.push(...rows);
    cursor = String(rows[rows.length - 1]?.id ?? '');
    if (rows.length < 500) break;
  }
  return out;
}

export async function listRegions(): Promise<MasterRegion[]> {
  const db = masterDb();
  if (!db) return [];
  const res = await db.prepare('SELECT * FROM MasterRegion ORDER BY region').all();
  return (res?.results ?? []).map(toRegion);
}

export async function getCustomerRow(id: string): Promise<any | null> {
  const db = masterDb();
  if (!db) return null;
  const row = await db.prepare(`SELECT ${DETAIL_COLUMNS} FROM MasterCustomer WHERE id = ?`).bind(id).first();
  return row ?? null;
}

/** Existing ids — lets an import report inserted vs updated without guessing. */
export async function listCustomerIds(): Promise<Set<string>> {
  const db = masterDb();
  if (!db) return new Set();
  const res = await db.prepare('SELECT id FROM MasterCustomer').all();
  return new Set(((res?.results ?? []) as any[]).map((r) => String(r.id)));
}

export async function countCustomers(): Promise<number> {
  const db = masterDb();
  if (!db) return 0;
  const row = await db.prepare('SELECT COUNT(*) AS n FROM MasterCustomer').first();
  return Number((row as any)?.n ?? 0) || 0;
}

// ── Writes ──────────────────────────────────────────────────────────────────

/** Column whitelist: patch key → MasterCustomer column. Anything else is
 *  ignored, so a crafted PATCH can never touch Zoho counters or the audit
 *  trail. `phones`/`emails` land in their JSON columns. */
export const PATCH_COLUMNS: Record<string, string> = {
  displayName: 'displayName',
  companyName: 'companyName',
  contactPerson: 'contactPerson',
  designation: 'designation',
  phones: 'phonesJson',
  emails: 'emailsJson',
  gstin: 'gstin',
  pincode: 'pincode',
  cityVerified: 'cityVerified',
  billingAddress: 'billingAddress',
  status: 'status',
  notes: 'notes',
  region: 'region',
  subArea: 'subArea',
  state: 'state',
};

/** Fields that reassign ownership / geography — sales-head + MIS only. */
export const MANAGER_ONLY_FIELDS = new Set(['region', 'subArea', 'state']);

export function patchToColumns(patch: Record<string, unknown>): { columns: string[]; values: any[] } {
  const columns: string[] = [];
  const values: any[] = [];
  for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
    if (!(key in patch)) continue;
    const raw = (patch as any)[key];
    let value: any;
    if (key === 'phones') value = JSON.stringify(Array.isArray(raw) ? raw.map(String).filter(Boolean) : []);
    else if (key === 'emails') value = JSON.stringify(Array.isArray(raw) ? raw.map(String).filter(Boolean) : []);
    else value = raw === null || raw === undefined ? '' : String(raw);
    columns.push(column);
    values.push(value);
  }
  return { columns, values };
}

export async function updateCustomerRow(id: string, columns: string[], values: any[]): Promise<void> {
  const db = masterDb();
  if (!db) throw new Error('database not ready');
  const sets = columns.map((c) => `${c} = ?`);
  sets.push('updatedAt = ?');
  const iso = new Date().toISOString();
  await db
    .prepare(`UPDATE MasterCustomer SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, iso, id)
    .run();
}

export async function markDuplicateGroupRow(group: string, review: DuplicateReview, actor: string): Promise<number> {
  const db = masterDb();
  if (!db) throw new Error('database not ready');
  const iso = new Date().toISOString();
  const res = await db
    .prepare(
      `UPDATE MasterCustomer
         SET duplicateReview = ?, reviewedBy = ?, reviewedAt = ?, updatedAt = ?
       WHERE duplicateGroup = ?`,
    )
    .bind(review, review === 'open' ? '' : actor, review === 'open' ? null : iso, iso, group)
    .run();
  return Number(res?.meta?.changes ?? res?.changes ?? 0) || 0;
}

/** Upsert one customer (source columns only — local notes/review survive). */
export function prepareUpsert(db: any, c: ImportCustomer): any {
  const iso = new Date().toISOString();
  return db
    .prepare(
      `INSERT INTO MasterCustomer (
         id, zohoCustomerId, region, zone, subArea, state, pincode, displayName, companyName,
         customerType, customerTypeBase, customerTypeTag, status, contactPerson, designation,
         phonesJson, emailsJson, billingAddress, gstin, owner, pipelineStage, estimateCount,
         lastEstimateDate, salesOrderCount, lastSalesOrderDate, cityZoho, cityVerified,
         citySource, locationBasis, duplicateGroup, duplicateConfidence, suggestedAction,
         createdAt, updatedAt
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         region = excluded.region, zone = excluded.zone, subArea = excluded.subArea,
         state = excluded.state, pincode = excluded.pincode, displayName = excluded.displayName,
         companyName = excluded.companyName, customerType = excluded.customerType,
         customerTypeBase = excluded.customerTypeBase, customerTypeTag = excluded.customerTypeTag,
         status = excluded.status, contactPerson = excluded.contactPerson,
         designation = excluded.designation, phonesJson = excluded.phonesJson,
         emailsJson = excluded.emailsJson, billingAddress = excluded.billingAddress,
         gstin = excluded.gstin, owner = excluded.owner, pipelineStage = excluded.pipelineStage,
         estimateCount = excluded.estimateCount, lastEstimateDate = excluded.lastEstimateDate,
         salesOrderCount = excluded.salesOrderCount, lastSalesOrderDate = excluded.lastSalesOrderDate,
         cityZoho = excluded.cityZoho, cityVerified = excluded.cityVerified,
         citySource = excluded.citySource, locationBasis = excluded.locationBasis,
         duplicateGroup = excluded.duplicateGroup,
         duplicateConfidence = excluded.duplicateConfidence,
         suggestedAction = excluded.suggestedAction, updatedAt = excluded.updatedAt`,
    )
    .bind(
      c.id, c.zohoCustomerId, c.region, c.zone, c.subArea, c.state, c.pincode,
      c.displayName, c.companyName, c.customerType, c.typeBase, c.typeTag, c.status,
      c.contactPerson, c.designation, JSON.stringify(c.phones), JSON.stringify(c.emails),
      c.billingAddress, c.gstin, c.owner, c.pipelineStage, c.estimateCount,
      c.lastEstimateDate || null, c.salesOrderCount, c.lastSalesOrderDate || null,
      c.cityZoho, c.cityVerified, c.citySource, c.locationBasis, c.duplicateGroup,
      c.duplicateConfidence, c.suggestedAction, iso, iso,
    );
}

/** Batch upsert (chunks of 20 — well under D1 per-batch limits). */
export async function upsertCustomers(customers: ImportCustomer[]): Promise<void> {
  const db = masterDb();
  if (!db) throw new Error('database not ready');
  const CHUNK = 20;
  for (let i = 0; i < customers.length; i += CHUNK) {
    const batch = customers.slice(i, i + CHUNK).map((c) => prepareUpsert(db, c));
    await db.batch(batch);
  }
}

export async function upsertRegions(regions: MasterRegion[]): Promise<void> {
  const db = masterDb();
  if (!db?.batch || regions.length === 0) return;
  const iso = new Date().toISOString();
  await db.batch(
    regions.map((r) =>
      db
        .prepare(
          `INSERT INTO MasterRegion (region, zone, coverage, salesPerson, allottedName, createdAt, updatedAt)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(region) DO UPDATE SET
             zone = excluded.zone, coverage = excluded.coverage,
             salesPerson = excluded.salesPerson, allottedName = excluded.allottedName,
             updatedAt = excluded.updatedAt`,
        )
        .bind(r.region, r.zone, r.coverage, r.salesPerson, r.allottedName, iso, iso),
    ),
  );
}

export async function insertAudit(entry: MasterDataAuditEntry): Promise<void> {
  const db = masterDb();
  if (!db) return;
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await db
    .prepare(
      `INSERT INTO MasterDataAudit (id, actorId, actorName, action, entityId, detail, createdAt)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(id, entry.actorId, entry.actorName, entry.action, entry.entityId, JSON.stringify(entry.detail ?? {}), new Date().toISOString())
    .run();
}

/** Last import/edit stamp for the header ("updated X ago"). */
export async function lastAuditAt(): Promise<string> {
  const db = masterDb();
  if (!db) return '';
  const row = await db.prepare('SELECT MAX(createdAt) AS at FROM MasterDataAudit').first();
  return String((row as any)?.at ?? '');
}
