// master-data-core-parity.test.mjs — Guard: the customer collapse (0136).
//
// Collapse 0136 made MasterCustomer BECOME core_customer: one table, no
// mirror, no flip flag. This guard locks the end state (text-level, so it
// runs anywhere with zero deps):
//   backend  → src/modules/master-data/store.ts   (single-table reads + tombstone writes)
//   backend  → migration 0136                      (RENAME + unification cols + bridge)
//   backend  → no `MasterCustomer` SQL table refs in unlocked src/
//              (locked modules/core/* excluded — human re-sign removes it;
//               migrations/ history + offline gen scripts excluded — they
//               record/emit history, never serve traffic)
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

const SRC = join(BACKEND_DIR, 'src');
const store = readFileSync(join(SRC, 'modules', 'master-data', 'store.ts'), 'utf8');
const service = readFileSync(join(SRC, 'modules', 'master-data', 'service.ts'), 'utf8');
const migration = readFileSync(join(BACKEND_DIR, 'migrations', '0136_customer_collapse.sql'), 'utf8');

function unlockedTsFiles(dir, out = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (p.includes(`${'/'}modules${'/'}core`)) continue; // locked — human re-signs
      unlockedTsFiles(p, out);
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

describe('customer collapse contract (0136)', () => {
  it('no legacy MasterCustomer SQL table refs in unlocked code', () => {
    const bad = [];
    for (const f of unlockedTsFiles(SRC)) {
      const s = readFileSync(f, 'utf8');
      if (/(FROM|INTO|UPDATE|TABLE)\s+MasterCustomer\b/.test(s)) bad.push(f);
    }
    assert.deepEqual(bad, [], `legacy table refs remain: ${bad.join(', ')}`);
  });

  it('book reads hit the unified table with tombstones excluded', () => {
    assert.ok(store.includes('LIVE_WHERE'), 'missing tombstone predicate');
    for (const fn of ['listAllCustomers', 'getCustomerRow', 'listCustomerIds', 'countCustomers']) {
      assert.ok(store.includes(fn), `missing ${fn}`);
    }
    assert.ok(!store.includes('FROM MasterCustomer'), 'store still reads the legacy name');
    assert.ok(store.includes('FROM core_customer'), 'store must read the unified table');
  });

  it('deletes tombstone — no row-deletes of the book', () => {
    assert.ok(!/DELETE\s+FROM\s+core_customer/i.test(store), 'store must never row-delete the book');
    assert.ok(store.includes("status = 'DELETED'"), 'delete path must tombstone');
    assert.ok(store.includes('tombstonedAt'), 'tombstone must be timestamped');
    assert.ok(store.includes('actorId'), 'writes must stamp the actor (unification column)');
  });

  it('service has no mirror calls and no flip flag', () => {
    assert.ok(!service.includes('mirrorCustomers'), 'dual-write funnel must be gone');
    assert.ok(!service.includes('mirrorCustomerRemoved'), 'tombstone funnel must be gone');
    assert.ok(!service.includes('read-source'), 'flip flag machinery must be gone');
    assert.ok(!existsSync(join(SRC, 'modules', 'master-data', 'read-source.ts')), 'read-source.ts must be deleted');
  });

  it('migration renames, unifies, and bridges', () => {
    assert.ok(migration.includes('DROP TABLE core_customer'), 'must drop the verified mirror first');
    assert.ok(migration.includes('ALTER TABLE MasterCustomer RENAME TO core_customer'), 'must rename legacy into core_*');
    for (const col of ['actorId', 'actorReason', 'tombstonedAt']) {
      assert.ok(migration.includes(`ADD COLUMN ${col}`), `missing unification column ${col}`);
    }
    assert.ok(migration.includes('CREATE VIEW MasterCustomer AS SELECT * FROM core_customer'), 'must leave a read bridge on the old name');
    assert.ok(migration.includes('INSTEAD OF INSERT') && migration.includes('INSTEAD OF UPDATE') && migration.includes('INSTEAD OF DELETE'), 'bridge must forward writes too');
  });
});
// Founder decision 2026-11-27: the 12 MB cap on the customer-master import is
// GONE. The old check also re-serialized the entire body just to measure it.
describe('master import has no size cap of its own', () => {
  const FE_IMPORT = join(BACKEND_DIR, '..', 'founder-os_frontend', 'src', 'components', 'master-data', 'ImportModal.tsx');

  it('service.ts does not measure or reject the upload', () => {
    assert.ok(!/MAX_IMPORT_BYTES/.test(service), 'a byte cap was re-added');
    assert.ok(!/file too large/i.test(service), 'the 413 must stay deleted (Cloudflare caps the request body)');
    assert.ok(!/JSON\.stringify\(json\)\.length/.test(service), 'never re-serialize the body just to size it');
  });

  it('the import dialog does not advertise a 12 MB limit', () => {
    const modal = readFileSync(FE_IMPORT, 'utf8');
    assert.ok(!/12\s?MB/i.test(modal), 'the UI still states a 12 MB cap');
  });
});

// The 2026-11-27 import landed 8,674 rows with EMPTY phones, emails and cities
// because `toImportCustomer` only knew the generated extract spellings
// ("Valid Phones / Mobiles", "City (Zoho)"). A Zoho CRM export spells the
// same columns "Phones" / "Emails" / "City" and carries extra people under
// "Additional Contact Persons" — both shapes must land the data.
describe('import reads the export spelling of every contact column', async () => {
  const parser = await import(pathToFileURL(bundleToFile(join(SRC, 'modules', 'master-data', 'import-parse.ts'))).href);

  const zoho = {
    'Record Type': 'customer',
    'Customer ID (Zoho)': '1584229000000265622',
    'Company Name': 'Shaktiman Rice & Flour Mill Pvt Ltd',
    'Display Name': 'Shaktiman Rice & Flour Mill Pvt Ltd',
    'Contact Person': 'Mr. Suresh Gupta',
    Designation: 'Owner',
    Phones: ['+919839098565', '+918604381882'],
    Emails: [],
    'Additional Contact Persons': [
      { Name: 'Bahadur Singh', Designation: 'Miller', Email: 'bahadur@mill.in', Phone: '+918604381882', Mobile: null },
    ],
    GSTIN: '09AADCM5201F1ZU',
    City: 'Fatehpur',
    State: 'Uttar Pradesh',
    Pincode: '212601',
    Region: 'R2',
  };

  it('the Studio export lands phones, emails, city and contacts', () => {
    const out = parser.parseImportPayload({ customers: [zoho] });
    const row = out.customers[0];
    assert.equal(out.skipped, 0, 'a complete record must never be skipped');
    assert.deepEqual(row.phones, ['+919839098565', '+918604381882'], 'phones (merged with the extra contact, de-duped)');
    assert.deepEqual(row.emails, ['bahadur@mill.in'], 'emails from the additional contact');
    assert.equal(row.cityZoho, 'Fatehpur', 'the plain City column filled City (Zoho)');
    assert.equal(row.contactPerson, 'Mr. Suresh Gupta');
    assert.equal(row.designation, 'Owner');
    assert.equal(row.gstin, '09AADCM5201F1ZU');
  });

  it('the generated extract spellings still land', () => {
    const out = parser.parseImportPayload([{
      'Customer ID (Zoho)': 'Z9', 'Display Name': 'Old Shape',
      'Valid Phones / Mobiles': JSON.stringify(['9839098565']),
      'Valid Emails': 'ops@old.in',
      'City (Zoho)': 'Ajmer',
      Contact: 'Asha', 'GST No': '09AADCM5201F1ZU',
    }]);
    const row = out.customers[0];
    assert.deepEqual(row.phones, ['9839098565']);
    assert.deepEqual(row.emails, ['ops@old.in']);
    assert.equal(row.cityZoho, 'Ajmer');
    assert.equal(row.contactPerson, 'Asha', 'the "Contact" spelling is accepted too');
    assert.equal(row.gstin, '09AADCM5201F1ZU');
  });

  it('a single pasted record imports, and skips say why', () => {
    const one = parser.parseImportPayload(zoho);
    assert.equal(one.customers.length, 1, 'a bare record is a one-row import');
    const bad = parser.parseImportPayload([{ 'Display Name': 'No id' }, { 'Customer ID (Zoho)': 'N1' }]);
    assert.equal(bad.skipped, 2);
    assert.equal(bad.skippedNoId, 1, 'the skip split names the missing id');
    assert.equal(bad.skippedNoName, 1, 'the skip split names the missing name');
  });
});
