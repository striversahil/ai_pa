#!/usr/bin/env node
// build-lead-import.mjs — traders.json + conveyor_belt.json → canonical import payload.
//
// Reads the two founder-supplied lead files (repo root), re-derives every
// region from the BOOK's own state→region map (the files' R1..R4/No_Location
// keys use a different regional scheme and are IGNORED), and writes one
// canonical `{ customers: [...] }` payload the Customer Master Import JSON
// button accepts (same lowercase keys toImportCustomer reads).
//
//   node scripts/build-lead-import.mjs              # dry-run report + payload
//
// Output: /tmp/opencode/lead-import.json (upload via Customer Master Import).
//
// Rules (founder-confirmed 2026-11-04):
// - Traders keep their Zoho IDs (upsert may UPDATE existing rows — the
//   dry-run lists every Zoho-ID overlap for review before the real write).
// - Conveyor rows get synthetic CB-<group>-<sno> IDs (zero Zoho collision).
// - Region: deterministic states map 1:1 per the book; UP via belt
//   (West→R1 / Central-Bundelkhand→R2 / East→R3 — traders Sub-Area maps
//   directly, conveyor City via the book's UP city→region table built below);
//   Maharashtra via Vidarbha split (Vidarbha belt→R2, rest→R4); blank/foreign
//   states → '' (Unmapped tab, fixed in the drawer).
// - Conveyor dedupe on phone-then-email (union phones/emails, first name wins,
//   all Product/Requirement lines appended into notes).
// - Junk: skip rows with no name AND no phone AND no email; phone-only leads
//   become 'Unknown Buyer – <phone>'. A name that is itself phone-like moves
//   into phones with a fallback display name.
// - Types: 'Reseller' / 'Conveyor Belt' (parse.ts TYPE_FAMILIES resolves the
//   base; 0104 seeds the ClientTypeRule rows).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const BOOK = join(ROOT, 'data', 'master_data.json');
const TRADERS = resolve(ROOT, '..', 'traders.json');
const CONVEYOR = resolve(ROOT, '..', 'conveyor_belt.json');
const OUT_DIR = '/tmp/opencode';
const OUT = join(OUT_DIR, 'lead-import.json');

const str = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// ── Book-derived maps ──────────────────────────────────────────────────────
// Deterministic states (every book state EXCEPT UP + Maharashtra, which split
// by belt — verified against data/master_data.json 2026-11-04).
const FIXED_STATE_REGION = {
  'andhra pradesh': 'R4', 'assam': 'R3', 'bangladesh': 'R3', 'bhutan': 'R3',
  'bihar': 'R3', 'chandigarh': 'R1', 'chhattisgarh': 'R2',
  'dadra and nagar haveli': 'R4', 'delhi': 'R1', 'new delhi': 'R1', 'goa': 'R4',
  'gujarat': 'R4', 'haryana': 'R1', 'himachal pradesh': 'R1',
  'jammu and kashmir': 'R1', 'jammu': 'R1', 'kashmir': 'R1', 'jharkhand': 'R3',
  'karnataka': 'R4', 'kerala': 'R4', 'madhya pradesh': 'R2', 'meghalaya': 'R3',
  'mizoram': 'R3', 'nagaland': 'R3', 'nepal': 'R3', 'odisha': 'R3', 'orissa': 'R3',
  'punjab': 'R1', 'rajasthan': 'R2', 'sikkim': 'R3', 'tamil nadu': 'R4',
  'telangana': 'R4', 'tripura': 'R3', 'uttarakhand': 'R1', 'west bengal': 'R3',
};
// UP + Maharashtra split by belt — never by majority.
const BELT_STATES = new Set(['uttar pradesh', 'up', 'maharashtra']);
// Vidarbha (Nagpur belt) → R2, rest of Maharashtra → R4 — exactly how the
// book already splits its 185 Maharashtra rows (19 R2 / 166 R4).
const VIDARBHA = ['nagpur', 'bhandara', 'gondia', 'gondiya', 'chandrapur', 'chanda',
  'gadchiroli', 'wardha', 'amravati', 'amrawati', 'akola', 'buldhana', 'buldana',
  'washim', 'yavatmal', 'vidarbha'];

function titleCase(s) {
  return str(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Book UP rows → city (lowercase) → majority region. Built from the book at
 *  runtime so new book extracts move the table automatically. */
function buildUpCityTable(book) {
  const votes = new Map();
  for (const [code, list] of Object.entries(book?.regions ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const r of list) {
      if (str(r?.State).toLowerCase() !== 'uttar pradesh') continue;
      const city = str(r?.['City (Verified)'] || r?.['City (Zoho)']).toLowerCase();
      if (!city) continue;
      if (!votes.has(city)) votes.set(city, {});
      const v = votes.get(city);
      v[code] = (v[code] ?? 0) + 1;
    }
  }
  const table = new Map();
  for (const [city, v] of votes) {
    const best = Object.entries(v).sort((a, b) => b[1] - a[1])[0][0];
    table.set(city, best);
  }
  return table;
}

/** Book rows → city (lowercase) → majority region, ALL states. Used ONLY as
 *  a fallback when the state field itself is blank/unknown (state-resolved
 *  rows never consult it — no silent overrides of a real state). */
function buildCityTable(book) {
  const votes = new Map();
  for (const [code, list] of Object.entries(book?.regions ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const r of list) {
      const city = str(r?.['City (Verified)'] || r?.['City (Zoho)']).toLowerCase();
      if (!city) continue;
      if (!votes.has(city)) votes.set(city, {});
      const v = votes.get(city);
      v[code] = (v[code] ?? 0) + 1;
    }
  }
  const table = new Map();
  for (const [city, v] of votes) {
    const best = Object.entries(v).sort((a, b) => b[1] - a[1])[0][0];
    table.set(city, best);
  }
  return table;
}

function upBeltFromSubArea(subArea) {
  const s = str(subArea).toLowerCase();
  if (!s.includes('uttar pradesh') && !s.includes('uttar') && !s.includes('(west)') &&
      !s.includes('(east)') && !s.includes('bundelkhand') && !s.includes('central')) return '';
  if (s.includes('west')) return 'R1';
  if (s.includes('central') || s.includes('bundelkhand')) return 'R2';
  if (s.includes('east')) return 'R3';
  return '';
}

function regionFor(state, { city = '', subArea = '', upCityTable, cityTable, stats }) {
  const st = str(state).toLowerCase();
  if (!st || st === 'unknown') {
    // State field blank — last resort is the book's city table (UP belt and
    // Vidarbha included). A miss stays Unmapped for the drawer to fix.
    const hit = cityTable?.get(str(city).toLowerCase());
    if (hit && stats) stats.cityRescued = (stats.cityRescued ?? 0) + 1;
    return hit ?? '';
  }
  if (FIXED_STATE_REGION[st]) return FIXED_STATE_REGION[st];
  if (st === 'uttar pradesh' || st === 'up') {
    const belt = upBeltFromSubArea(subArea);
    if (belt) return belt;
    const hit = upCityTable.get(str(city).toLowerCase());
    return hit ?? '';
  }
  if (st === 'maharashtra') {
    const hay = `${subArea} ${city}`.toLowerCase();
    return VIDARBHA.some((d) => hay.includes(d)) ? 'R2' : 'R4';
  }
  return ''; // foreign/garbage → Unmapped
}

// ── phones/emails ──────────────────────────────────────────────────────────
function normPhone(v) {
  const raw = str(v);
  if (!raw) return '';
  const plus = raw.startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 6) return '';
  if (!plus && digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  return `${plus ? '+' : ''}${digits}`;
}
function normEmail(v) {
  const raw = str(v).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw.slice(0, 200) : '';
}
const listOf = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const phonesOf = (v) => [...new Set(listOf(v).map(normPhone).filter(Boolean))];
const emailsOf = (v) => [...new Set(listOf(v).map(normEmail).filter(Boolean))];
const isPhoneLike = (s) => {
  const digits = str(s).replace(/[^\d]/g, '');
  return digits.length >= 7 && digits.length <= 13 && /^[\d\s+\-()]+$/.test(str(s));
};

// ── conveyor state resolution ──────────────────────────────────────────────
// cleaned wins; else scan raw State + City for the longest known state name;
// a bare 6-digit raw State is a pincode, not a state.
function knownStates() {
  return [...Object.keys(FIXED_STATE_REGION), 'uttar pradesh', 'maharashtra']
    .sort((a, b) => b.length - a.length);
}
function resolveConveyor(row) {
  const cleaned = str(row['State (Cleaned)']);
  if (cleaned && cleaned.toLowerCase() !== 'none') {
    return { state: titleCase(cleaned), pincode: '', via: 'cleaned' };
  }
  const raw = str(row['State']);
  let pincode = '';
  let hay = `${raw} ${row['City'] ?? ''}`.toLowerCase();
  if (/^\d{6}$/.test(raw.trim())) {
    pincode = raw.trim();
    hay = str(row['City']).toLowerCase();
  }
  const hit = knownStates().find((s) => hay.includes(s));
  if (hit) {
    const pretty = hit === 'orissa' ? 'Odisha' : titleCase(hit);
    return { state: pretty, pincode, via: pincode ? 'city-scan+pincode' : 'raw-scan' };
  }
  return { state: '', pincode, via: 'unmapped' };
}

// ── builders ───────────────────────────────────────────────────────────────
function buildTrader(raw, ctx) {
  const state = titleCase(raw['State']);
  const subArea = str(raw['Sub-Area']);
  const city = str(raw['City (Verified)'] || raw['City (Zoho)']);
  const region = regionFor(state, { city, subArea, ...ctx });
  const zohoId = str(raw['Customer ID (Zoho)']);
  return {
    id: zohoId,
    zohoCustomerId: zohoId,
    region,
    zone: '',
    subArea,
    state: ['unknown', 'none'].includes(state.toLowerCase()) ? '' : state,
    pincode: '',
    displayName: str(raw['Display Name']).slice(0, 200),
    companyName: str(raw['Company Name']).slice(0, 200),
    customerType: 'Reseller',
    status: 'Active',
    contactPerson: str(raw['Contact Person']).slice(0, 120),
    designation: str(raw['Designation']).slice(0, 80),
    phones: phonesOf(raw['Phones']).slice(0, 20),
    emails: emailsOf(raw['Emails']).slice(0, 20),
    billingAddress: str(raw['Address']).slice(0, 600),
    gstin: /^[0-9A-Z]{15}$/i.test(str(raw['GSTIN']).replace(/\s+/g, '')) ? str(raw['GSTIN']).replace(/\s+/g, '').toUpperCase() : '',
    owner: str(raw['Owner']).slice(0, 40),
    pipelineStage: str(raw['Pipeline Stage']).slice(0, 40),
    estimateCount: Number(raw['# Estimates']) > 0 ? Math.floor(Number(raw['# Estimates'])) : 0,
    lastEstimateDate: '',
    salesOrderCount: Number(raw['# Sales Orders']) > 0 ? Math.floor(Number(raw['# Sales Orders'])) : 0,
    lastSalesOrderDate: /^\d{4}-\d{2}-\d{2}/.test(str(raw['Last Sales Order Date'])) ? str(raw['Last Sales Order Date']).slice(0, 10) : '',
    cityZoho: str(raw['City (Zoho)']).slice(0, 80),
    cityVerified: str(raw['City (Verified)']).slice(0, 80),
    citySource: str(raw['City Source']).slice(0, 120),
    locationBasis: 'lead-import',
    duplicateGroup: str(raw['Duplicate Group']).slice(0, 20),
    duplicateConfidence: str(raw['Duplicate Confidence']).slice(0, 20),
    suggestedAction: str(raw['Duplicate Action']).slice(0, 60),
    notes: '',
  };
}

function buildConveyor(group, raw, ctx, stats) {
  let name = str(raw['Customer Name']);
  let phones = phonesOf(raw['Phones']);
  let emails = emailsOf(raw['Emails']);
  // A name that is itself a phone number belongs in phones, not the name.
  if (!phones.length && name && isPhoneLike(name)) {
    phones = phonesOf([name]);
    stats.phoneNameRescued++;
    name = '';
  }
  const requirement = str(raw['Product / Requirement']);
  if (!name && !phones.length && !emails.length) {
    stats.junkSkipped++;
    return null;
  }
  if (!name) {
    name = `Unknown Buyer – ${phones[0] ?? emails[0]}`;
    stats.fallbackNames++;
  }
  const { state, pincode, via } = resolveConveyor(row_norm(raw));
  stats.stateVia[via] = (stats.stateVia[via] ?? 0) + 1;
  const city = titleCase(raw['City']);
  return {
    key: phones[0] ?? `email:${emails[0]}`,
    row: {
      id: `CB-${group}-${str(raw['S.No']) || 'X'}`,
      zohoCustomerId: `CB-${group}-${str(raw['S.No']) || 'X'}`,
      region: regionFor(state, { city, subArea: '', ...ctx, stats }),
      zone: '',
      subArea: '',
      state,
      pincode,
      displayName: name.slice(0, 200),
      companyName: '',
      customerType: 'Conveyor Belt',
      status: 'Active',
      contactPerson: '',
      designation: '',
      phones: phones.slice(0, 20),
      emails: emails.slice(0, 20),
      billingAddress: '',
      gstin: '',
      owner: '',
      pipelineStage: '',
      estimateCount: 0,
      lastEstimateDate: '',
      salesOrderCount: 0,
      lastSalesOrderDate: '',
      cityZoho: '',
      cityVerified: city.slice(0, 80),
      citySource: 'lead-import',
      locationBasis: 'lead-import',
      duplicateGroup: '',
      duplicateConfidence: '',
      suggestedAction: '',
      notes: requirement.slice(0, 2000),
    },
  };
}
// row_norm: guard against non-object rows (never crash the run on one bad row).
function row_norm(raw) {
  return raw && typeof raw === 'object' ? raw : {};
}

// ── main ───────────────────────────────────────────────────────────────────
function main() {
  const book = JSON.parse(readFileSync(BOOK, 'utf8'));
  const upCityTable = buildUpCityTable(book);
  const cityTable = buildCityTable(book);
  const ctx = { upCityTable, cityTable };
  const traders = JSON.parse(readFileSync(TRADERS, 'utf8'));
  const conveyor = JSON.parse(readFileSync(CONVEYOR, 'utf8'));

  const stats = {
    tradersTotal: 0, tradersKept: 0, tradersNoId: 0,
    conveyorTotal: 0, junkSkipped: 0, fallbackNames: 0, phoneNameRescued: 0,
    dedupeGroups: 0, dedupeMerged: 0, stateVia: {}, regions: {},
  };
  const out = [];
  const traderIds = [];

  for (const [group, list] of Object.entries(traders?.regions ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      stats.tradersTotal++;
      const row = buildTrader(raw ?? {}, ctx);
      if (!row.zohoCustomerId || !row.displayName) { stats.tradersNoId++; continue; }
      stats.tradersKept++;
      traderIds.push(row.zohoCustomerId);
      out.push(row);
    }
  }

  const groups = new Map(); // dedupe key → merged row
  for (const [group, list] of Object.entries(conveyor?.regions ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      stats.conveyorTotal++;
      const built = buildConveyor(group, raw ?? {}, ctx, stats);
      if (!built) continue;
      const prev = groups.get(built.key);
      if (!prev) {
        groups.set(built.key, built.row);
      } else {
        // Merge: union phones/emails, first real name wins, requirements append.
        prev.phones = [...new Set([...prev.phones, ...built.row.phones])].slice(0, 20);
        prev.emails = [...new Set([...prev.emails, ...built.row.emails])].slice(0, 20);
        if (prev.displayName.startsWith('Unknown Buyer') && !built.row.displayName.startsWith('Unknown Buyer')) {
          prev.displayName = built.row.displayName;
        }
        if (built.row.notes && !prev.notes.includes(built.row.notes)) {
          prev.notes = `${prev.notes}\n${built.row.notes}`.slice(0, 2000);
        }
        if (!prev.state && built.row.state) {
          prev.state = built.row.state;
          prev.region = built.row.region;
          prev.cityVerified = prev.cityVerified || built.row.cityVerified;
        }
        stats.dedupeMerged++;
      }
    }
  }
  stats.dedupeGroups = groups.size;
  for (const row of groups.values()) out.push(row);

  // Region buckets across the whole payload.
  for (const r of out) {
    const k = r.region || 'Unmapped';
    stats.regions[k] = (stats.regions[k] ?? 0) + 1;
  }

  // Sanity: every row must carry one of the two new families (nothing falls
  // through to Other/Unspecified — that would mean a TYPE_FAMILIES gap).
  const types = {};
  for (const r of out) types[r.customerType] = (types[r.customerType] ?? 0) + 1;

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify({ customers: out }, null, 1));
  const kb = Math.round(Buffer.byteLength(JSON.stringify({ customers: out })) / 1024);

  // Trader Zoho-ID overlap note: the Import UI upserts on id, so any of these
  // IDs already in the book will UPDATE that row (region/type overwrite).
  // The mismatch review runs as a read-only D1 query after this report.
  writeFileSync(join(OUT_DIR, 'lead-trader-ids.json'), JSON.stringify(traderIds));

  console.log('── lead import dry-run ──');
  console.log(`traders:  total=${stats.tradersTotal} kept=${stats.tradersKept} skipped-no-id-or-name=${stats.tradersNoId}`);
  console.log(`conveyor: total=${stats.conveyorTotal} groups=${stats.dedupeGroups} merged-dupes=${stats.dedupeMerged} junk-skipped=${stats.junkSkipped} fallback-names=${stats.fallbackNames} phone-names-rescued=${stats.phoneNameRescued}`);
  console.log(`regions:  ${Object.entries(stats.regions).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`conveyor state-via: ${Object.entries(stats.stateVia).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`types:    ${Object.entries(types).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`payload:  ${out.length} customers, ~${kb} KB → ${OUT}`);
  console.log(`book city tables: UP=${upCityTable.size} all=${cityTable.size}; city-rescued=${stats.cityRescued ?? 0}`);
}

main();
