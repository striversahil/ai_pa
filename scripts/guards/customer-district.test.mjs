// customer-district.test.mjs — Guard: the district-wise customer book (2026-11-14).
//
// Locks the end state (text-level, so it runs anywhere with zero deps):
//   backend  → migration 0144 (district column + index + backfill) exists
//   backend  → store.ts reads/writes district (LIST_COLUMNS + PATCH_COLUMNS +
//              MANAGER_ONLY_FIELDS), parse.ts toCustomer serves it, types carry
//              it, upsert never writes it (flat Zoho re-imports cannot wipe it)
//   backend  → campaign selection reads district (CUSTOMER_COLUMNS +
//              listCustomersByState district filter + listDistrictCounts),
//              batch ledger records it (BATCH_COLUMNS + toBatch), detail1 folds
//              to "State · District", districts route registered
//   frontend → master-data mirror (types + filters + drawer draft/manager keys)
//   frontend → campaign mirror (district on preview/batch + district counts)
//   frontend → Customer Master renders the District filter, campaign renders
//              the District picker
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
const campStorePure = read(join(SRC, 'modules', 'neodove-campaign', 'store-parts', 'pure.ts'));
const campStoreIo = read(join(SRC, 'modules', 'neodove-campaign', 'store-parts', 'io.ts'));
const campSvcIo = read(join(SRC, 'modules', 'neodove-campaign', 'service-parts', 'io.ts'));
const campRoutes = read(join(SRC, 'worker', 'routes', 'neodove-campaign.ts'));

const feTypes = read(join(FE, 'master-data', 'types.ts'));
const feFilters = read(join(FE, 'master-data', 'filters.ts'));
const feView = read(join(FE, 'components', 'master-data', 'MasterDataView.tsx'));
const feDrawerHelpers = read(join(FE, 'components', 'master-data', 'customer-drawer', 'helpers.ts'));
const feDraftTypes = read(join(FE, 'components', 'master-data', 'customer-drawer', 'types.ts'));
const feCampMirror = read(join(FE, 'telecalling', 'neodove-campaign.ts'));
const feCampSection = read(join(FE, 'components', 'telecalling', 'NeoDoveCampaignSection.tsx'));

describe('district column + backfill (0144)', () => {
  it('migration adds the column, the index, and the backfill', () => {
    const mig = join(BACKEND_DIR, 'migrations', '0144_customer_district.sql');
    assert.ok(existsSync(mig), '0144 migration missing');
    const sql = read(mig);
    assert.ok(sql.includes('ADD COLUMN district'), 'missing ADD COLUMN district');
    assert.ok(sql.includes('core_customer_district_idx'), 'missing district index');
    assert.ok(/^UPDATE core_customer SET district = /m.test(sql), 'missing backfill UPDATEs');
  });

  it('batch ledger migration records the push district (0145)', () => {
    const mig = join(BACKEND_DIR, 'migrations', '0145_neodove_batch_district.sql');
    assert.ok(existsSync(mig), '0145 migration missing');
    assert.ok(read(mig).includes('ADD COLUMN district'), 'batch missing district column');
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

describe('backend campaign pushes districts', () => {
  it('selection reads district, ledger records it', () => {
    assert.ok(campStorePure.includes("'district'"), 'CUSTOMER_COLUMNS missing district');
    assert.ok(campStorePure.includes("'district'") && campStorePure.includes("'id', 'region', 'state', 'district'"), 'BATCH_COLUMNS missing district');
    assert.ok(campStoreIo.includes('listDistrictCounts'), 'missing listDistrictCounts');
    assert.ok(campStoreIo.includes('lastDistrictPushes'), 'missing lastDistrictPushes');
    assert.ok(/listCustomersByState\(region: string, state: string, clientType = '', district = ''\)/.test(campStoreIo), 'selection must accept district');
  });

  it('preview folds district into detail1, push persists it', () => {
    assert.ok(campSvcIo.includes('getCampaignDistricts'), 'missing getCampaignDistricts');
    assert.ok(campSvcIo.includes('`${stateName} · ${distName}`'), 'detail1 must fold to "State · District"');
    assert.ok(campSvcIo.includes('district: distName'), 'createPush must persist district');
  });

  it('districts route registered, preview/push/types thread district', () => {
    assert.ok(campRoutes.includes('/api/neodove/campaign/districts'), 'missing districts route');
    assert.ok(campRoutes.includes("c.req.query('district')"), 'preview/types must read district');
    assert.ok(campRoutes.includes('district: body?.district'), 'push must read district');
  });
});

describe('frontend mirrors district', () => {
  it('master-data mirror: types, filter, drawer', () => {
    assert.ok(feTypes.includes('district: string') && feTypes.includes('district?: string'), 'FE types missing district');
    assert.ok(feFilters.includes('district: "",') || feFilters.includes('district: "",'), 'EMPTY_FILTERS missing district');
    assert.ok(feFilters.includes('if (f.district && r.district !== f.district) return false'), 'matchesFilters missing district');
    assert.ok(feFilters.includes('districts: string[]'), 'FilterOptions missing districts');
    assert.ok(feFilters.includes('["District", (r) => r.district]'), 'CSV missing District column');
    assert.ok(feView.includes('label="District"'), 'MasterDataView missing District filter');
    assert.ok(feDrawerHelpers.includes('"district"') || feDrawerHelpers.includes("'district'"), 'drawer DRAFT/MANAGER keys missing district');
    assert.ok(feDraftTypes.includes('district: string'), 'Draft type missing district');
  });

  it('campaign mirror: preview/batch/districts + picker UI', () => {
    assert.ok(feCampMirror.includes('CampaignDistrictCount'), 'FE mirror missing district counts');
    assert.ok(feCampMirror.includes('district: string'), 'FE mirror missing district on preview/batch');
    assert.ok(feCampSection.includes('/api/neodove/campaign/districts'), 'section missing districts fetch');
    assert.ok(feCampSection.includes('District'), 'section missing District picker');
  });
});
