// enquiry-known-rates.test.mjs — Guard: Product Line → loop known-rates picker.
//
// Locks the end state (text-level, zero deps):
//   backend  → GET /api/enquiries/product-rates exists, gated to privileged
//              desks (procurement scope or Management Review — never sales);
//              resolution reuses match.ts (resolveProduct / rankProducts) over
//              the cached product-line accessors (no second matcher, no new
//              write endpoint — selection rides the existing PATCH).
//   frontend → ONE shared picker (KnownRatesPicker, data via @/enquiry/api,
//              never fetch in the component) mounted ONLY on the two
//              privileged item views (ProcurementItemCard "Add this quote",
//              ManagementRatesPanel staged "Use this rate" + decide);
//              never on any sales surface; every selection stamps the
//              Product Line trace note; sales redaction stays intact.
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR } from './_bundle.mjs';

const SRC = join(BACKEND_DIR, 'src');
const FE = join(BACKEND_DIR, '..', 'founder-os_frontend', 'src');
const read = (p) => readFileSync(join(FE, ...p), 'utf8');
const beread = (p) => readFileSync(join(SRC, ...p), 'utf8');

const mod = beread(['modules', 'enquiries', 'product-rates.ts']);
const resolver = beread(['modules', 'enquiries', 'catalogue-resolve.ts']);
const routes = beread(['worker', 'routes', 'enquiries.ts']);
const api = read(['enquiry', 'api.ts']);
const picker = read(['components', 'KnownRatesPicker.tsx']);
const proc = read(['components', 'ProcurementItemCard.tsx']);
const mgmt = read(['components', 'ManagementRatesPanel.tsx']);
const salesSurf = read(['components', 'SpecificationsSection.tsx']);

describe('backend: privileged read-only lookup', () => {
  it('route registered with the privileged-desk gate', () => {
    assert.ok(routes.includes("'/api/enquiries/product-rates'") || routes.includes('"/api/enquiries/product-rates"'), 'missing product-rates route');
    assert.ok(routes.includes('canSeeProcurementRequests'), 'must gate on procurement / Management Review (never sales)');
    assert.ok(routes.includes('lookupKnownRates'), 'route must delegate to the shared module (thin handler)');
  });

  it('module reuses the product-line matcher (no second matcher)', () => {
    assert.ok(mod.includes('resolveProduct') && mod.includes('rankProducts'), 'must reuse match.ts resolution');
    assert.ok(mod.includes('getProductIndex') && mod.includes('getRatesForProduct'), 'must read the cached product-line accessors');
    assert.ok(mod.includes('founder-os_frontend/src/enquiry/api.ts'), 'must carry the frontend mirror path');
  });

  it('misses route through the shared AI resolver (no second prompt/chain)', () => {
    assert.ok(resolver.includes('lookupDeterministic') && resolver.includes('lookupToken'), 'must reuse the intake deterministic tiers');
    assert.ok(resolver.includes('LOOKUP_FALLBACK_SYSTEM') && resolver.includes('buildLookupList'), 'must reuse the intake fallback prompt + catalogue list');
    assert.ok(resolver.includes('resolveIntakeChain') && resolver.includes('resolveLegModel'), 'must reuse the intake provider order + leg models');
    assert.ok(resolver.includes('RESOLVE_CONFIDENCE_MIN') && resolver.includes('0.65'), '0.65 confidence gate must be present');
    assert.ok(resolver.includes('cached') && resolver.includes('RESOLVE_TTL_MS'), 'resolves must be KV-cached per item text (no re-burn)');
    assert.ok(mod.includes('resolveCatalogueItem'), 'product-rates must delegate misses to the shared resolver');
    assert.ok(api.includes('spec'), 'spec/qty must thread from the picker to the endpoint');
  });

  it('no new write endpoint — selection rides the existing PATCH', () => {
    assert.ok(!/app\.(post|put|patch|delete)\(['"]\/api\/enquiries\/product-rates/.test(routes), 'lookup must stay a GET; writes ride PATCH /api/enquiries/:id');
    assert.ok(mod.includes('Quote imported from Product Line') || proc.includes('Quote imported from Product Line') || mgmt.includes('Quote imported from Product Line'), 'trace stamp must exist on the write path');
  });
});

describe('frontend: one shared picker, privileged surfaces only', () => {
  it('domain api owns the fetch (components never spell the path)', () => {
    assert.ok(api.includes('/api/enquiries/product-rates'), 'fetchKnownRates must live in @/enquiry/api');
    assert.ok(api.includes('product-rates.ts'), 'api must name its backend mirror');
    assert.ok(!picker.includes('fetch('), 'picker must go through the domain api');
  });

  it('picker mounted on procurement (Add this quote) only', () => {
    assert.ok(proc.includes('KnownRatesPicker'), 'procurement card must mount the picker');
    assert.ok(proc.includes('Add this quote'), 'procurement action is quote insert');
    assert.ok(proc.includes("onLoopOpen(\"note\"") || proc.includes("onLoopOpen('note'"), 'procurement insert stamps the trace note');
  });

  it('picker mounted on management (staged Use this rate + decide) only', () => {
    assert.ok(mgmt.includes('KnownRatesPicker'), 'management panel must mount the picker');
    assert.ok(mgmt.includes('Use this rate'), 'management action inserts AND decides');
    assert.ok(mgmt.includes('stagedRates'), 'management stages through buildItems — never a second save path');
  });

  it('never on the sales surface; sales redaction intact', () => {
    assert.ok(!salesSurf.includes('KnownRatesPicker'), 'sales must never see vendor names');
    const strip = beread(['modules', 'enquiries', 'scopes.ts']);
    assert.ok(strip.includes('stripMarginFields'), 'sales redaction stays the enforcement point');
  });
});
