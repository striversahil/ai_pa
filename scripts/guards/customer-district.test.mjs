// customer-district.test.mjs — Guard: the district-wise customer book (2026-11-14).
//
// Locks the end state (text-level, so it runs anywhere with zero deps):
//   backend  → migration 0144 (district column + index + backfill) exists
//   backend  → store.ts reads/writes district (LIST_COLUMNS + PATCH_COLUMNS +
//              MANAGER_ONLY_FIELDS), parse.ts toCustomer serves it, types carry
//              it, upsert never writes it (flat Zoho re-imports cannot wipe it)
//   frontend → master-data mirror (types + filters + drawer draft/manager keys)
//   frontend → Customer Master renders the District filter
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR } from './_bundle.mjs';

const SRC = join(BACKEND_DIR, 'src');
const FE = join(BACKEND_DIR, '..', 'founder-os_frontend', 'src');
const read = (p) => readFileSync(p, 'utf8');

const store = read(join(SRC, 'modules', 'master-data', 'store.ts'));
const parse = read(join(SRC, 'modules', 'master-data', 'parse.ts'));
const beTypes = read(join(SRC, 'modules', 'master-data', 'types.ts'));
const beService = read(join(SRC, 'modules', 'master-data', 'service.ts'));
const beListQuery = read(join(SRC, 'modules', 'master-data', 'list-query.ts'));

const feTypes = read(join(FE, 'master-data', 'types.ts'));
const feFilters = read(join(FE, 'master-data', 'filters.ts'));
// The filter panel was extracted from the view (2026-11-21) — read both.
const feView = read(join(FE, 'components', 'master-data', 'MasterDataView.tsx'))
  + read(join(FE, 'components', 'master-data', 'master-data-view', 'FilterPanel.tsx'));
const feDrawerHelpers = read(join(FE, 'components', 'master-data', 'customer-drawer', 'helpers.ts'));
const feDraftTypes = read(join(FE, 'components', 'master-data', 'customer-drawer', 'types.ts'));

describe('district column + backfill (0144)', () => {
  it('migration adds the column, the index, and the backfill', () => {
    const mig = join(BACKEND_DIR, 'migrations', '0144_customer_district.sql');
    assert.ok(existsSync(mig), '0144 migration missing');
    const sql = read(mig);
    assert.ok(sql.includes('ADD COLUMN district'), 'missing ADD COLUMN district');
    assert.ok(sql.includes('core_customer_district_idx'), 'missing district index');
    assert.ok(/^UPDATE core_customer SET district = /m.test(sql), 'missing backfill UPDATEs');
  });
});

describe('backend book serves district', () => {
  it('store reads + patches district as manager-only geography', () => {
    assert.ok(store.includes("'district'"), 'LIST_COLUMNS missing district');
    assert.ok(store.includes("district: 'district'"), 'PATCH_COLUMNS missing district');
    assert.ok(/MANAGER_ONLY_FIELDS = new Set\(\[[^\]]*'district'[^\]]*\]\)/.test(store), 'district must be manager-only');
  });

  it('upsert never writes district (flat re-imports cannot wipe it)', () => {
    const upsert = store.slice(store.indexOf('export function prepareUpsert'));
    assert.ok(!/\bdistrict\b/.test(upsert), 'prepareUpsert must not touch district');
  });

  it('parse + types carry district, service sanitizes it', () => {
    assert.ok(parse.includes('district: cleanText(row?.district'), 'toCustomer missing district');
    assert.ok(beTypes.includes('district: string') && beTypes.includes('district?: string'), 'backend types missing district');
    assert.ok(beService.includes("if ('district' in patch)"), 'sanitizePatch missing district');
  });
});

describe('frontend mirrors district', () => {
  it('master-data mirror: types, filter, drawer', () => {
    assert.ok(feTypes.includes('district: string') && feTypes.includes('district?: string'), 'FE types missing district');
    assert.ok(feFilters.includes('district: "",'), 'EMPTY_FILTERS missing district');
    // Filtering moved server-side 2026-11-21 (founder paging standard): the
    // district predicate lives in list-query.ts, the FE only sends the param.
    assert.ok(beListQuery.includes("eq(T('district'), f.district)"), 'server list filter missing district');
    assert.ok(feFilters.includes('district: f.district'), 'filterParams must send district');
    assert.ok(feTypes.includes('districts: string[]'), 'FilterOptions missing districts');
    assert.ok(feFilters.includes('["District", (r) => r.district]'), 'CSV missing District column');
    assert.ok(feView.includes('label="District"'), 'MasterDataView missing District filter');
    assert.ok(feDrawerHelpers.includes('"district"') || feDrawerHelpers.includes("'district'"), 'drawer DRAFT/MANAGER keys missing district');
    assert.ok(feDraftTypes.includes('district: string'), 'Draft type missing district');
  });
});
