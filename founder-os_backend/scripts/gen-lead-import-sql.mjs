#!/usr/bin/env node
// gen-lead-import-sql.mjs — /tmp/opencode/lead-import.json → chunked D1 upsert files.
//
// Same column mapping + conflict semantics as store.prepareUpsert (including
// the notes CASE-WHEN that preserves hand-written notes). Applied with:
//   npx wrangler d1 execute waba-worker --remote --file <each file in order>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const IN = '/tmp/opencode/lead-import.json';
const OUT_DIR = '/tmp/opencode/lead-sql';
const ROWS_PER_STATEMENT = 20;
const STATEMENTS_PER_FILE = 60;

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => String(Number(v) || 0);
const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v ?? '')) ? q(String(v).slice(0, 10)) : 'NULL');

// The converter only ever emits these two families — assert, never silently
// remap. (Base/tag mirror parse.ts normalizeCustomerType for these inputs.)
function baseTag(customerType) {
  if (customerType === 'Reseller') return ['Reseller', ''];
  if (customerType === 'Conveyor Belt') return ['Conveyor Belt', ''];
  throw new Error(`unexpected customerType ${JSON.stringify(customerType)}`);
}

function rowValues(r, iso) {
  const [base, tag] = baseTag(r.customerType);
  return [
    q(r.id), q(r.zohoCustomerId), q(r.region), q(r.zone), q(r.subArea), q(r.state),
    q(r.pincode), q(r.displayName), q(r.companyName), q(r.customerType), q(base), q(tag),
    q(r.status), q(r.contactPerson), q(r.designation),
    q(JSON.stringify(r.phones ?? [])), q(JSON.stringify(r.emails ?? [])),
    q(r.billingAddress), q(r.gstin), q(r.owner), q(r.pipelineStage),
    n(r.estimateCount), dateOrNull(r.lastEstimateDate),
    n(r.salesOrderCount), dateOrNull(r.lastSalesOrderDate),
    q(r.cityZoho), q(r.cityVerified), q(r.citySource), q(r.locationBasis),
    q(r.duplicateGroup), q(r.duplicateConfidence), q(r.suggestedAction),
    q(r.notes ?? ''), q(iso), q(iso),
  ];
}

function main() {
  const { customers } = JSON.parse(readFileSync(IN, 'utf8'));
  if (!Array.isArray(customers) || !customers.length) throw new Error('no customers in payload');
  const iso = new Date().toISOString();
  const statements = [];
  for (let i = 0; i < customers.length; i += ROWS_PER_STATEMENT) {
    const chunk = customers.slice(i, i + ROWS_PER_STATEMENT);
    statements.push(
      `INSERT INTO MasterCustomer (id, zohoCustomerId, region, zone, subArea, state, pincode, ` +
      `displayName, companyName, customerType, customerTypeBase, customerTypeTag, status, ` +
      `contactPerson, designation, phonesJson, emailsJson, billingAddress, gstin, owner, ` +
      `pipelineStage, estimateCount, lastEstimateDate, salesOrderCount, lastSalesOrderDate, ` +
      `cityZoho, cityVerified, citySource, locationBasis, duplicateGroup, duplicateConfidence, ` +
      `suggestedAction, notes, createdAt, updatedAt) VALUES\n` +
      chunk.map((r) => `(${rowValues(r, iso).join(', ')})`).join(',\n') +
      `\nON CONFLICT(id) DO UPDATE SET region = excluded.region, zone = excluded.zone, ` +
      `subArea = excluded.subArea, state = excluded.state, pincode = excluded.pincode, ` +
      `displayName = excluded.displayName, companyName = excluded.companyName, ` +
      `customerType = excluded.customerType, customerTypeBase = excluded.customerTypeBase, ` +
      `customerTypeTag = excluded.customerTypeTag, status = excluded.status, ` +
      `contactPerson = excluded.contactPerson, designation = excluded.designation, ` +
      `phonesJson = excluded.phonesJson, emailsJson = excluded.emailsJson, ` +
      `billingAddress = excluded.billingAddress, gstin = excluded.gstin, owner = excluded.owner, ` +
      `pipelineStage = excluded.pipelineStage, estimateCount = excluded.estimateCount, ` +
      `lastEstimateDate = excluded.lastEstimateDate, salesOrderCount = excluded.salesOrderCount, ` +
      `lastSalesOrderDate = excluded.lastSalesOrderDate, cityZoho = excluded.cityZoho, ` +
      `cityVerified = excluded.cityVerified, citySource = excluded.citySource, ` +
      `locationBasis = excluded.locationBasis, duplicateGroup = excluded.duplicateGroup, ` +
      `duplicateConfidence = excluded.duplicateConfidence, suggestedAction = excluded.suggestedAction, ` +
      `notes = CASE WHEN MasterCustomer.notes IS NULL OR MasterCustomer.notes = '' ` +
      `THEN excluded.notes ELSE MasterCustomer.notes END, updatedAt = excluded.updatedAt;`,
    );
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const files = [];
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_FILE) {
    const file = join(OUT_DIR, `lead_${String(files.length + 1).padStart(2, '0')}.sql`);
    writeFileSync(file, `${statements.slice(i, i + STATEMENTS_PER_FILE).join('\n\n')}\n`);
    files.push(file);
  }
  console.log(`wrote ${files.length} files, ${statements.length} statements, ${customers.length} rows`);
}

main();
