// import-parse.ts — the import half of the customer-master parser (pure, no I/O).
//
// Split out of parse.ts when the accepted-column-spelling table pushed that
// file to the 400-line cap; parse.ts re-exports everything here, so callers
// keep importing from './parse'.
import type { ImportCustomer, MasterRegion } from './types';
import {
  cleanBlock, cleanText, normalizeCustomerType, normalizeDate, normalizeEmail,
  normalizeGstin, normalizePhone, normalizeStatus, toCount, uniqueList,
} from './parse';
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

// ── Column spellings ────────────────────────────────────────────────────────
//
// Zoho does not keep ONE spelling per column: the generated master extract
// says "Valid Phones / Mobiles" / "City (Zoho)", a fresh Zoho CRM export says
// "Phones" / "Emails" / "City" / "Additional Contact Persons", a hand-built
// file says camelCase. Every field therefore reads a LIST of accepted
// spellings (first non-empty wins) so a new export shape can never silently
// drop a column — which is exactly how phones, emails and cities imported as
// blanks for 8,674 rows on 2026-11-27 while the rest of each row landed.
const PHONE_KEYS = [
  'Valid Phones / Mobiles', 'Phones', 'Phone', 'Phone Numbers', 'Phone Number',
  'Mobile', 'Mobiles', 'Mobile Number', 'Contact Number', 'WhatsApp', 'phones', 'phone',
];
const EMAIL_KEYS = [
  'Valid Emails', 'Emails', 'Email', 'Email Address', 'E-mail', 'email', 'emails',
];
const CONTACT_KEYS = ['Contact Person', 'Contact', 'Contact Name', 'Primary Contact', 'contactPerson'];
const DESIGNATION_KEYS = ['Designation', 'Contact Designation', 'Title', 'designation'];
const GSTIN_KEYS = ['GSTIN', 'GSTIN/UIN', 'GST No', 'GST Number', 'GSTIN No', 'GST', 'gstin'];
const CITY_KEYS = ['City (Zoho)', 'City', 'City Name', 'Town', 'cityZoho', 'city'];
const PINCODE_KEYS = ['Pincode', 'Pin Code', 'PIN', 'Postal Code', 'Zip', 'ZIP', 'pincode'];
const CONTACT_LIST_KEYS = [
  'Additional Contact Persons', 'Additional Contacts', 'Contact Persons', 'Contacts', 'additionalContacts',
];

/** First non-empty value among the accepted spellings of one column. */
function pickFirst(raw: any, keys: string[]): any {
  for (const key of keys) {
    const value = raw?.[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    return value;
  }
  return undefined;
}

/** A multi-value column: an array, a JSON array string, or "a, b; c" text. */
export function parseValueList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x ?? '').trim()).filter(Boolean);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const text = raw.trim();
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x ?? '').trim()).filter(Boolean);
    } catch { /* not JSON — fall through to the separator split */ }
  }
  return text.split(/[,;\n|]+/).map((x) => x.trim()).filter(Boolean);
}

/** Extra people on the account ("Additional Contact Persons"). Their phones
 *  and emails belong to the client, so they merge into the record's lists —
 *  the book stores one contact person, not a people table. */
function importContacts(raw: any): Array<{ name: string; designation: string; phones: string[]; emails: string[] }> {
  const list = pickFirst(raw, CONTACT_LIST_KEYS);
  if (!Array.isArray(list)) return [];
  const out: Array<{ name: string; designation: string; phones: string[]; emails: string[] }> = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const phones = ['Phone', 'Mobile', 'Phones', 'Mobiles', 'Phone Number', 'Contact Number']
      .flatMap((k) => parseValueList(entry[k])).map(normalizePhone);
    const emails = ['Email', 'Emails', 'Email Address']
      .flatMap((k) => parseValueList(entry[k])).map(normalizeEmail);
    out.push({
      name: cleanText(pickFirst(entry, ['Name', 'Full Name', 'Contact Person', 'Contact']), 120),
      designation: cleanText(pickFirst(entry, ['Designation', 'Title', 'Role']), 80),
      phones: uniqueList(phones),
      emails: uniqueList(emails),
    });
  }
  return out;
}

/** One raw customer object (from the file) → the canonical import row. */
export function toImportCustomer(raw: any, fallbackRegion: string): ImportCustomer {
  const type = normalizeCustomerType(pickFirst(raw, ['Customer Type', 'customerType']));
  const zohoId = cleanText(pickFirst(raw, ['Customer ID (Zoho)', 'zohoCustomerId', 'id', 'Customer Id']), 40);
  const region = cleanText(raw?.Region ?? raw?.region, 8) || cleanText(fallbackRegion, 8);
  const contacts = importContacts(raw);
  // A record with no primary contact person still has people on it — the first
  // named one fills the column instead of leaving it blank.
  const named = contacts.find((c) => c.name);
  return {
    id: zohoId,
    zohoCustomerId: zohoId,
    region,
    zone: cleanText(raw?.Zone ?? raw?.zone, 40),
    subArea: cleanText(raw?.['Sub-Area'] ?? raw?.subArea, 80),
    state: cleanText(raw?.State ?? raw?.state, 80),
    pincode: cleanText(pickFirst(raw, PINCODE_KEYS), 12),
    displayName: cleanText(
      pickFirst(raw, ['Display Name', 'displayName', 'Company Name', 'companyName', 'name']), 200,
    ),
    companyName: cleanText(pickFirst(raw, ['Company Name', 'companyName', 'Display Name']), 200),
    customerType: cleanText(pickFirst(raw, ['Customer Type', 'customerType']), 120),
    typeBase: type.base,
    typeTag: type.tag,
    status: normalizeStatus(raw?.Status ?? raw?.status),
    contactPerson: cleanText(pickFirst(raw, CONTACT_KEYS) ?? named?.name, 120),
    designation: cleanText(pickFirst(raw, DESIGNATION_KEYS) ?? named?.designation, 80),
    phones: uniqueList([
      ...parseValueList(pickFirst(raw, PHONE_KEYS)).map(normalizePhone),
      ...contacts.flatMap((c) => c.phones),
    ]),
    emails: uniqueList([
      ...parseValueList(pickFirst(raw, EMAIL_KEYS)).map(normalizeEmail),
      ...contacts.flatMap((c) => c.emails),
    ]),
    billingAddress: cleanBlock(raw?.['Billing Address'] ?? raw?.billingAddress, 600),
    gstin: normalizeGstin(pickFirst(raw, GSTIN_KEYS)),
    owner: cleanText(raw?.Owner ?? raw?.owner, 40),
    pipelineStage: cleanText(raw?.['Pipeline Stage'] ?? raw?.pipelineStage, 40),
    estimateCount: toCount(raw?.['# Estimates'] ?? raw?.estimateCount),
    lastEstimateDate: normalizeDate(raw?.['Last Estimate Date'] ?? raw?.lastEstimateDate),
    salesOrderCount: toCount(raw?.['# Sales Orders'] ?? raw?.salesOrderCount),
    lastSalesOrderDate: normalizeDate(raw?.['Last Sales Order Date'] ?? raw?.lastSalesOrderDate),
    cityZoho: cleanText(pickFirst(raw, CITY_KEYS), 80),
    cityVerified: cleanText(pickFirst(raw, ['City (Verified)', 'cityVerified']), 80),
    citySource: cleanText(raw?.['City Source'] ?? raw?.citySource, 120),
    locationBasis: cleanText(raw?.['Location Basis'] ?? raw?.locationBasis, 40),
    duplicateGroup: cleanText(raw?.['Duplicate Group'] ?? raw?.duplicateGroup, 20),
    duplicateConfidence: cleanText(raw?.['Duplicate Confidence'] ?? raw?.duplicateConfidence, 20),
    suggestedAction: cleanText(raw?.['Suggested Action'] ?? raw?.suggestedAction, 60),
    // Lead notes (conveyor Product/Requirement). The store upsert only seeds
    // this when the stored row has none — hand-written notes always win.
    notes: cleanBlock(raw?.notes ?? raw?.['Product / Requirement'] ?? '', 2000),
  };
}

/** Whole file → regions + rows. Tolerates four input shapes:
 *   { summary, regions: { R1: [...] } }  (the master extract)
 *   { customers: [...] } / bare array     (a flat export)
 *   one bare record                       (a single-client test import)
 *  The skip count is split into no-id / no-name so the import result can say
 *  WHY records were dropped instead of reporting a bare number. */
export function parseImportPayload(json: any): {
  regions: MasterRegion[];
  customers: ImportCustomer[];
  skipped: number;
  skippedNoId: number;
  skippedNoName: number;
} {
  const regions = parseImportRegions(json);
  const out: ImportCustomer[] = [];
  let skipped = 0;
  let skippedNoId = 0;
  let skippedNoName = 0;
  const push = (raw: any, fallback: string) => {
    const row = toImportCustomer(raw, fallback);
    const noId = !row.zohoCustomerId;
    const noName = !row.displayName;
    if (noId) skippedNoId++;
    if (noName) skippedNoName++;
    if (noId || noName) {
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
  } else if (json && typeof json === 'object') {
    push(json, '');
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
  return { regions, customers: out, skipped, skippedNoId, skippedNoName };
}
