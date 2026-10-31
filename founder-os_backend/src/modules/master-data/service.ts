// service.ts — read/write lifecycles for the customer master.
//
// Reads serve one KV-cached payload (regions + compact rows + totals): the
// dashboard filters/sorts client-side, so the whole book must arrive in one
// request. Writes are narrow (a record patch, a duplicate-group review, a JSON
// re-import) and every one of them invalidates the cache + audits the actor.
import { cached, cacheDel } from '../../shared/cache';
import type {
  CustomerPatch, DuplicateReview, MasterCustomerDetail, MasterDataPayload,
  MasterDataTotals, MasterImportResult,
} from './types';
import { isDuplicateReview } from './types';
import {
  cleanText, toCustomer, toCustomerDetail, parseImportPayload, normalizePhone,
  normalizeEmail, normalizeGstin, cleanBlock,
} from './parse';
import {
  countCustomers, getCustomerRow, insertAudit, lastAuditAt, listAllCustomers,
  listRegions, upsertCustomers, upsertRegions, updateCustomerRow, patchToColumns,
  MANAGER_ONLY_FIELDS, markDuplicateGroupRow, PATCH_COLUMNS, listCustomerIds,
} from './store';

export const MASTER_CACHE_KEY = 'master:data:v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

export class MasterDataError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Every write funnels through here so no caller forgets the invalidation. */
export async function invalidateMasterDataCache(): Promise<void> {
  await cacheDel(MASTER_CACHE_KEY);
}

function emptyTotals(): MasterDataTotals {
  return {
    total: 0, active: 0, inactive: 0, neverTouched: 0, estimateOnly: 0,
    salesOrderOnly: 0, estimateAndOrder: 0, duplicateRows: 0, duplicateGroups: 0,
    duplicateHigh: 0, duplicateMedium: 0, duplicateReview: 0, duplicateReviewed: 0,
    noPhone: 0, noEmail: 0, noGstin: 0, noPincode: 0, byRegion: {}, regionIds: [],
  };
}

/** Totals are derived from the same rows the table renders, so every tile can
 *  be explained by filtering the list (never a second, drifting query). */
export function computeTotals(rows: ReturnType<typeof toCustomer>[]): MasterDataTotals {
  const t = emptyTotals();
  const groups = new Map<string, { review: boolean }>();
  for (const r of rows) {
    t.total++;
    if (r.status === 'Inactive') t.inactive++;
    else t.active++;
    if (r.estCount === 0 && r.soCount === 0) t.neverTouched++;
    else if (r.estCount > 0 && r.soCount > 0) t.estimateAndOrder++;
    else if (r.estCount > 0) t.estimateOnly++;
    else t.salesOrderOnly++;
    if (!r.phones.length) t.noPhone++;
    if (!r.emails.length) t.noEmail++;
    if (!r.gstin) t.noGstin++;
    if (!r.pincode) t.noPincode++;
    if (r.duplicateGroup) {
      t.duplicateRows++;
      if (r.duplicateConfidence === 'High') t.duplicateHigh++;
      else if (r.duplicateConfidence === 'Medium') t.duplicateMedium++;
      else if (r.duplicateConfidence === 'Review') t.duplicateReview++;
      if (r.duplicateReview !== 'open') t.duplicateReviewed++;
      const g = groups.get(r.duplicateGroup);
      if (g) g.review = g.review && r.duplicateReview !== 'open';
      else groups.set(r.duplicateGroup, { review: r.duplicateReview !== 'open' });
    }
    if (r.region) t.byRegion[r.region] = (t.byRegion[r.region] ?? 0) + 1;
  }
  t.duplicateGroups = groups.size;
  t.regionIds = Object.keys(t.byRegion).sort();
  return t;
}

async function computePayload(): Promise<MasterDataPayload> {
  const [regions, rawRows, updatedAt] = await Promise.all([
    listRegions(),
    listAllCustomers(),
    lastAuditAt(),
  ]);
  const rows = rawRows.map(toCustomer).sort((a, b) => a.name.localeCompare(b.name));
  return {
    generatedAt: new Date().toISOString(),
    updatedAt,
    regions,
    rows,
    totals: computeTotals(rows),
  };
}

/** Dashboard payload — one KV-cached compute per window per isolate. */
export async function getMasterDataPayload(): Promise<MasterDataPayload> {
  return cached<MasterDataPayload>(MASTER_CACHE_KEY, CACHE_TTL_MS, computePayload);
}

/** Header stamp: last import or edit. Cheap enough to sit outside the payload
 *  cache (single-row read) but folded into it to keep the route to one call. */
export async function getMasterDataStamp(): Promise<{ updatedAt: string; count: number }> {
  const [updatedAt, count] = await Promise.all([lastAuditAt(), countCustomers()]);
  return { updatedAt, count };
}

export async function getCustomerDetail(id: string): Promise<MasterCustomerDetail> {
  const key = cleanText(id, 60);
  if (!key) throw new MasterDataError('customer id is required', 400);
  const row = await getCustomerRow(key);
  if (!row) throw new MasterDataError('customer not found', 404);
  return toCustomerDetail(row);
}

// ── Writes ──────────────────────────────────────────────────────────────────

function sanitizePatch(patch: CustomerPatch): { clean: Record<string, unknown>; changed: string[] } {
  const clean: Record<string, unknown> = {};
  const changed: string[] = [];
  const put = (key: string, value: unknown) => {
    clean[key] = value;
    changed.push(key);
  };
  if ('displayName' in patch) put('displayName', cleanText(patch.displayName, 200));
  if ('companyName' in patch) put('companyName', cleanText(patch.companyName, 200));
  if ('contactPerson' in patch) put('contactPerson', cleanText(patch.contactPerson, 120));
  if ('designation' in patch) put('designation', cleanText(patch.designation, 80));
  if ('phones' in patch) {
    const list = Array.isArray(patch.phones) ? patch.phones : [];
    put('phones', list.map(normalizePhone).filter(Boolean).slice(0, 20));
  }
  if ('emails' in patch) {
    const list = Array.isArray(patch.emails) ? patch.emails : [];
    put('emails', list.map(normalizeEmail).filter(Boolean).slice(0, 20));
  }
  if ('gstin' in patch) put('gstin', normalizeGstin(patch.gstin));
  if ('pincode' in patch) put('pincode', cleanText(patch.pincode, 12));
  if ('cityVerified' in patch) put('cityVerified', cleanText(patch.cityVerified, 80));
  if ('billingAddress' in patch) put('billingAddress', cleanBlock(patch.billingAddress, 600));
  if ('notes' in patch) put('notes', cleanBlock(patch.notes, 2000));
  if ('status' in patch) {
    const s = cleanText(patch.status, 20).toLowerCase();
    put('status', s.startsWith('inactive') ? 'Inactive' : 'Active');
  }
  if ('region' in patch) put('region', cleanText(patch.region, 8).toUpperCase());
  if ('subArea' in patch) put('subArea', cleanText(patch.subArea, 80));
  if ('state' in patch) put('state', cleanText(patch.state, 80));
  // Never let an unknown key through.
  for (const key of Object.keys(clean)) {
    if (!(key in PATCH_COLUMNS)) delete clean[key];
  }
  return { clean, changed: changed.filter((k) => k in PATCH_COLUMNS) };
}

export interface Actor {
  id: string;
  name: string;
}

export async function updateCustomer(
  id: string,
  patch: CustomerPatch,
  actor: Actor,
  isManager: boolean,
): Promise<MasterCustomerDetail> {
  const key = cleanText(id, 60);
  if (!key) throw new MasterDataError('customer id is required', 400);
  const existing = await getCustomerRow(key);
  if (!existing) throw new MasterDataError('customer not found', 404);
  const { clean, changed } = sanitizePatch(patch ?? {});
  if (changed.length === 0) throw new MasterDataError('nothing to update', 400);
  const managerOnly = changed.filter((k) => MANAGER_ONLY_FIELDS.has(k));
  if (managerOnly.length > 0 && !isManager) {
    throw new MasterDataError(
      `only the sales-head or MIS can change ${managerOnly.join(', ')}`,
      403,
    );
  }
  const { columns, values } = patchToColumns(clean);
  await updateCustomerRow(key, columns, values);
  await insertAudit({
    actorId: actor.id, actorName: actor.name, action: 'customer-edit', entityId: key,
    detail: { fields: changed, before: Object.fromEntries(changed.map((k) => [k, (existing as any)[PATCH_COLUMNS[k]] ?? ''])) },
  });
  await invalidateMasterDataCache();
  return getCustomerDetail(key);
}

export async function setDuplicateReview(
  group: string,
  review: DuplicateReview,
  actor: Actor,
): Promise<{ group: string; review: DuplicateReview; changed: number }> {
  const g = cleanText(group, 20);
  if (!g) throw new MasterDataError('duplicate group is required', 400);
  if (!isDuplicateReview(review)) throw new MasterDataError('review must be open, keep-master or ignored', 400);
  const changed = await markDuplicateGroupRow(g, review, actor.name);
  if (changed === 0) throw new MasterDataError('duplicate group not found', 404);
  await insertAudit({
    actorId: actor.id, actorName: actor.name, action: 'duplicate-review', entityId: g,
    detail: { review, rows: changed },
  });
  await invalidateMasterDataCache();
  return { group: g, review, changed };
}

const MAX_IMPORT_BYTES = 12 * 1024 * 1024;

/** Re-import the master extract (same shape as data/master_data.json).
 *  Upsert-only: rows missing from the file are never deleted — a partial
 *  extract must not wipe the book. Local fields (notes, duplicate review)
 *  survive because the upsert does not touch them. */
export async function importMasterData(json: unknown, actor: Actor): Promise<MasterImportResult> {
  if (!json || typeof json !== 'object') throw new MasterDataError('expected a JSON object', 400);
  const size = JSON.stringify(json).length;
  if (size > MAX_IMPORT_BYTES) throw new MasterDataError('file too large (max 12 MB)', 413);
  const parsed = parseImportPayload(json);
  if (parsed.customers.length === 0) {
    throw new MasterDataError('no customers found — expected { summary, regions: { R1: [...] } }', 400);
  }
  const existing = await listCustomerIds();
  let inserted = 0;
  let updated = 0;
  for (const c of parsed.customers) {
    if (existing.has(c.zohoCustomerId)) updated++;
    else inserted++;
  }
  await upsertRegions(parsed.regions);
  await upsertCustomers(parsed.customers);
  await insertAudit({
    actorId: actor.id, actorName: actor.name, action: 'import', entityId: 'master',
    detail: { received: parsed.customers.length, inserted, updated, skipped: parsed.skipped, regions: parsed.regions.length },
  });
  await invalidateMasterDataCache();
  return {
    received: parsed.customers.length,
    inserted,
    updated,
    skipped: parsed.skipped,
    regions: parsed.regions.length,
    errors: [],
  };
}
