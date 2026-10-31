// parse.ts — pure parsers/normalizers for the customer master.
//
// Everything here is framework-free so the same rules run at seed time
// (scripts/gen-master-data-migration.mjs), at import time (POST
// /api/master-data/import) and at read time (store.ts → API rows).
// No I/O, no globals.
import type {
  DuplicateReview,
  ImportCustomer,
  MasterCustomer,
  MasterCustomerDetail,
  MasterRegion,
} from './types';
import { isDuplicateReview } from './types';

/** Trim + collapse whitespace; null/undefined → "". */
export function cleanText(v: unknown, max = 400): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Free-text notes/addresses keep line breaks (they are multi-line by nature). */
export function cleanBlock(v: unknown, max = 2000): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\r\n/g, '\n').trim().slice(0, max);
}

/**
 * Phone normalizer: keep the leading country code and digits only.
 * `+91 98765 43210` / `098765-43210` / `+977 98570 22211` all collapse to a
 * dialable string. Anything shorter than 6 digits is dropped (not a phone).
 */
export function normalizePhone(v: unknown): string {
  const raw = String(v ?? '').trim();
  if (!raw) return '';
  const plus = raw.startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 6) return '';
  // Local 0-prefixed Indian numbers → +91 form (the extract already normalizes,
  // this only guards pasted rows).
  if (!plus && digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  return `${plus ? '+' : ''}${digits}`;
}

/** Emails are matched case-insensitively; store lowercase. */
export function normalizeEmail(v: unknown): string {
  const raw = String(v ?? '').trim().toLowerCase();
  if (!raw) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return '';
  return raw.slice(0, 200);
}

export function normalizeGstin(v: unknown): string {
  const raw = String(v ?? '').replace(/\s+/g, '').toUpperCase();
  return /^[0-9A-Z]{15}$/.test(raw) ? raw : '';
}

/** Accepts Date / ISO datetime / YYYY-MM-DD; always returns YYYY-MM-DD or "". */
export function normalizeDate(v: unknown): string {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toISOString().slice(0, 10);
}

function toCount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function uniqueList(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** Parse a JSON array column (or pass through an already-parsed array). */
export function parseJsonList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x ?? '').trim()).filter(Boolean);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// ── Customer type: 65 spellings → one family + a qualifier ───────────────────
//
// The Zoho extract encodes the state inside the type ("Flour Mill MP",
// "Flour Mill j&K", "Flour Mill Nepal"), mixes case ("fLOUR mILL") and uses
// shorthand ("FM", "RFM"). The view filters on the family and shows the
// qualifier as a chip; the raw value is preserved for export/editing.

const TYPE_FAMILIES: Array<{ base: string; test: RegExp }> = [
  { base: 'Flour Mill', test: /\b(flour\s*mills?|flour|fm|rfm)\b/ },
  { base: 'Maida Plant', test: /\bmaida\b/ },
  { base: 'Chakki Mill', test: /\bchakki\b/ },
];

export function normalizeCustomerType(raw: unknown): { base: string; tag: string } {
  const text = cleanText(raw, 120).replace(/^[.\s]+/, '');
  if (!text) return { base: 'Unspecified', tag: '' };
  const lower = text.toLowerCase();
  // A description ("Manufacturer of pulses, maida, wheat and flour.") is not a
  // mill family — the filter must not claim it is one.
  if (/manufacturer of/.test(lower)) return { base: 'Other', tag: '' };
  const hit = TYPE_FAMILIES.find((f) => f.test.test(lower));
  if (!hit) return { base: 'Other', tag: '' };
  // Drop every token belonging to the family name ("flour mill", "mills",
  // "fm", "rfm"…), keep the qualifier that follows ("MP", "Nepal").
  let rest = lower
    .replace(/^[.\s]+/, '')
    .replace(/\b(flour\s*mills?|flour|mills?|maida\s*plant|maida|chakki\s*mill|chakki|fm|rfm)\b/g, ' ')
    .replace(/[.,&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (rest.split(' ').length > 2) rest = '';
  const tag = rest ? rest.toUpperCase().slice(0, 12) : '';
  return { base: hit.base, tag };
}

export function normalizeStatus(v: unknown): 'Active' | 'Inactive' {
  const s = cleanText(v, 20).toLowerCase();
  return s.startsWith('inactive') ? 'Inactive' : 'Active';
}

// ── D1 row → API shape ──────────────────────────────────────────────────────

function rowPhones(row: any): string[] {
  return uniqueList(parseJsonList(row?.phonesJson).map(normalizePhone));
}

function rowEmails(row: any): string[] {
  return uniqueList(parseJsonList(row?.emailsJson).map(normalizeEmail));
}

export function toCustomer(row: any): MasterCustomer {
  return {
    id: String(row?.id ?? ''),
    zohoCustomerId: String(row?.zohoCustomerId ?? ''),
    name: cleanText(row?.displayName, 200),
    company: cleanText(row?.companyName, 200),
    customerType: cleanText(row?.customerType, 120),
    typeBase: cleanText(row?.customerTypeBase, 80) || 'Unspecified',
    typeTag: cleanText(row?.customerTypeTag, 20),
    status: normalizeStatus(row?.status),
    contact: cleanText(row?.contactPerson, 120),
    designation: cleanText(row?.designation, 80),
    region: cleanText(row?.region, 8),
    zone: cleanText(row?.zone, 40),
    subArea: cleanText(row?.subArea, 80),
    state: cleanText(row?.state, 80),
    city: cleanText(row?.cityVerified, 80) || cleanText(row?.cityZoho, 80),
    pincode: cleanText(row?.pincode, 12),
    phones: rowPhones(row),
    emails: rowEmails(row),
    gstin: cleanText(row?.gstin, 20),
    owner: cleanText(row?.owner, 40),
    pipeline: cleanText(row?.pipelineStage, 40),
    estCount: toCount(row?.estimateCount),
    lastEstimateDate: normalizeDate(row?.lastEstimateDate),
    soCount: toCount(row?.salesOrderCount),
    lastSalesOrderDate: normalizeDate(row?.lastSalesOrderDate),
    duplicateGroup: cleanText(row?.duplicateGroup, 20),
    duplicateConfidence: cleanText(row?.duplicateConfidence, 20),
    duplicateAction: cleanText(row?.suggestedAction, 60),
    duplicateReview: isDuplicateReview(row?.duplicateReview) ? (row.duplicateReview as DuplicateReview) : 'open',
    hasNote: !!cleanText(row?.notes, 10),
  };
}

export function toCustomerDetail(row: any): MasterCustomerDetail {
  return {
    ...toCustomer(row),
    cityZoho: cleanText(row?.cityZoho, 80),
    cityVerified: cleanText(row?.cityVerified, 80),
    citySource: cleanText(row?.citySource, 120),
    locationBasis: cleanText(row?.locationBasis, 40),
    billingAddress: cleanBlock(row?.billingAddress ?? row?.BillingAddress ?? '', 600),
    notes: cleanBlock(row?.notes, 2000),
    reviewedBy: cleanText(row?.reviewedBy, 120),
    reviewedAt: normalizeDate(row?.reviewedAt),
    updatedAt: cleanText(row?.updatedAt, 40),
  };
}

export function toRegion(row: any): MasterRegion {
  return {
    region: cleanText(row?.region, 8),
    zone: cleanText(row?.zone, 40),
    coverage: cleanBlock(row?.coverage, 500),
    salesPerson: cleanText(row?.salesPerson, 120),
    allottedName: cleanText(row?.allottedName, 160),
  };
}

// ── Import shape (master_data.json) → canonical rows ────────────────────────

/** Pull the region rows out of the file's `summary` block (tolerant of a
 *  missing block — regions then derive from the customer rows themselves). */
export function parseImportRegions(json: any): MasterRegion[] {
  const summary = Array.isArray(json?.summary) ? json.summary : Array.isArray(json?.regionsSummary) ? json.regionsSummary : [];
  return summary
    .map((r: any) => ({
      region: cleanText(r?.Region ?? r?.region, 8),
      zone: cleanText(r?.Zone ?? r?.zone, 40),
      coverage: cleanBlock(r?.Coverage ?? r?.coverage, 500),
      salesPerson: cleanText(r?.['Sales Person'] ?? r?.salesPerson, 120),
      allottedName: cleanText(r?.['Allotted Name'] ?? r?.allottedName, 160),
    }))
    .filter((r: MasterRegion) => !!r.region);
}

/** One raw customer object (from the file) → the canonical import row. */
export function toImportCustomer(raw: any, fallbackRegion: string): ImportCustomer {
  const type = normalizeCustomerType(raw?.['Customer Type'] ?? raw?.customerType);
  const zohoId = cleanText(raw?.['Customer ID (Zoho)'] ?? raw?.zohoCustomerId ?? raw?.id, 40);
  const region = cleanText(raw?.Region ?? raw?.region, 8) || cleanText(fallbackRegion, 8);
  return {
    id: zohoId,
    zohoCustomerId: zohoId,
    region,
    zone: cleanText(raw?.Zone ?? raw?.zone, 40),
    subArea: cleanText(raw?.['Sub-Area'] ?? raw?.subArea, 80),
    state: cleanText(raw?.State ?? raw?.state, 80),
    pincode: cleanText(raw?.Pincode ?? raw?.pincode, 12),
    displayName: cleanText(raw?.['Display Name'] ?? raw?.displayName ?? raw?.name, 200),
    companyName: cleanText(raw?.['Company Name'] ?? raw?.companyName, 200),
    customerType: cleanText(raw?.['Customer Type'] ?? raw?.customerType, 120),
    typeBase: type.base,
    typeTag: type.tag,
    status: normalizeStatus(raw?.Status ?? raw?.status),
    contactPerson: cleanText(raw?.['Contact Person'] ?? raw?.contactPerson, 120),
    designation: cleanText(raw?.Designation ?? raw?.designation, 80),
    phones: uniqueList(parseJsonList(raw?.['Valid Phones / Mobiles'] ?? raw?.phones).map(normalizePhone)),
    emails: uniqueList(parseJsonList(raw?.['Valid Emails'] ?? raw?.emails).map(normalizeEmail)),
    billingAddress: cleanBlock(raw?.['Billing Address'] ?? raw?.billingAddress, 600),
    gstin: normalizeGstin(raw?.GSTIN ?? raw?.gstin),
    owner: cleanText(raw?.Owner ?? raw?.owner, 40),
    pipelineStage: cleanText(raw?.['Pipeline Stage'] ?? raw?.pipelineStage, 40),
    estimateCount: toCount(raw?.['# Estimates'] ?? raw?.estimateCount),
    lastEstimateDate: normalizeDate(raw?.['Last Estimate Date'] ?? raw?.lastEstimateDate),
    salesOrderCount: toCount(raw?.['# Sales Orders'] ?? raw?.salesOrderCount),
    lastSalesOrderDate: normalizeDate(raw?.['Last Sales Order Date'] ?? raw?.lastSalesOrderDate),
    cityZoho: cleanText(raw?.['City (Zoho)'] ?? raw?.cityZoho, 80),
    cityVerified: cleanText(raw?.['City (Verified)'] ?? raw?.cityVerified, 80),
    citySource: cleanText(raw?.['City Source'] ?? raw?.citySource, 120),
    locationBasis: cleanText(raw?.['Location Basis'] ?? raw?.locationBasis, 40),
    duplicateGroup: cleanText(raw?.['Duplicate Group'] ?? raw?.duplicateGroup, 20),
    duplicateConfidence: cleanText(raw?.['Duplicate Confidence'] ?? raw?.duplicateConfidence, 20),
    suggestedAction: cleanText(raw?.['Suggested Action'] ?? raw?.suggestedAction, 60),
  };
}

/** Whole file → regions + rows. Tolerates three input shapes:
 *   { summary, regions: { R1: [...] } }  (the master extract)
 *   { customers: [...] } / bare array     (a flat export) */
export function parseImportPayload(json: any): {
  regions: MasterRegion[];
  customers: ImportCustomer[];
  skipped: number;
} {
  const regions = parseImportRegions(json);
  const out: ImportCustomer[] = [];
  let skipped = 0;
  const push = (raw: any, fallback: string) => {
    const row = toImportCustomer(raw, fallback);
    if (!row.zohoCustomerId || !row.displayName) {
      skipped++;
      return;
    }
    out.push(row);
  };
  const grouped = json?.regions;
  if (grouped && typeof grouped === 'object' && !Array.isArray(grouped)) {
    for (const [regionId, list] of Object.entries(grouped)) {
      if (!Array.isArray(list)) continue;
      for (const raw of list) push(raw, regionId);
    }
  } else if (Array.isArray(json?.customers)) {
    for (const raw of json.customers) push(raw, '');
  } else if (Array.isArray(json)) {
    for (const raw of json) push(raw, '');
  }
  // Regions missing from the summary block (flat imports) derive from the rows.
  const known = new Set(regions.map((r) => r.region));
  for (const c of out) {
    if (c.region && !known.has(c.region)) {
      known.add(c.region);
      regions.push({ region: c.region, zone: c.zone || '', coverage: '', salesPerson: '', allottedName: '' });
    }
  }
  regions.sort((a, b) => a.region.localeCompare(b.region));
  return { regions, customers: out, skipped };
}
