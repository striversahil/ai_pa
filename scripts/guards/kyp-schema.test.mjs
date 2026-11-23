// kyp-schema.test.mjs — Guard: the KYP schema file (v2) is the sole truth for
// products, their category, their aliases/discovery words and the spec-ask.
//
// Founder decision 2026-11-23: `resources/json/kyp/bui_milling_vendor_kyp_schema_v2.json`
// is the source; the system runs on two GENERATED artifacts:
//   · founder-os_backend/src/automations/product-line/kyp-catalog.ts
//   · founder-os_backend/migrations/0156_kyp_catalog_v2_seed.sql
// This guard fails when either drifts from the JSON, or when the JSON itself
// breaks the shape the runtime relies on.
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BACKEND_DIR, FRONTEND_SRC, REPO_ROOT, bundleToFile } from './_bundle.mjs';

const SCHEMA_PATH = join(REPO_ROOT, 'resources', 'json', 'kyp', 'bui_milling_vendor_kyp_schema_v2.json');
const CATALOG_TS = join(BACKEND_DIR, 'src', 'automations', 'product-line', 'kyp-catalog.ts');
const SEED_PATH = join(BACKEND_DIR, 'migrations', '0156_kyp_catalog_v2_seed.sql');

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const seedSql = readFileSync(SEED_PATH, 'utf8');

let products = [];
let byKey = new Map();

before(async () => {
  // Bundle the generated catalog so the guard reads what the Worker reads.
  const mod = await import(pathToFileURL(bundleToFile(CATALOG_TS)).href);
  products = mod.KYP_PRODUCTS;
  byKey = new Map(products.map((p) => [p.key, p]));
});

describe('kyp schema v2 — generated artifacts are current', () => {
  it('catalog + seed migration match the schema file', () => {
    execFileSync('node', [join(BACKEND_DIR, 'scripts', 'gen-kyp-catalog.mjs'), '--check'], {
      cwd: BACKEND_DIR,
      stdio: 'pipe',
    });
  });
});

describe('kyp schema v2 — shape the runtime depends on', () => {
  it('every allOf branch has a definition, a category and aliases', () => {
    const branches = schema.allOf ?? [];
    assert.equal(branches.length, Object.keys(schema.definitions).length, 'one branch per product');
    for (const b of branches) {
      const key = b.if.properties.product_key.const;
      assert.ok(schema.definitions[key], `${key}: definitions entry`);
      const cat = b.then.properties.category;
      assert.ok(cat?.const || (cat?.enum && cat.enum.length), `${key}: category bound`);
      assert.ok((b.then.properties.aliases?.default ?? []).length >= 1, `${key}: aliases default`);
      assert.equal(b.then.properties.specs.$ref, `#/definitions/${key}`, `${key}: specs ref`);
    }
  });

  it('catalog covers every product exactly once, with a real category', () => {
    const keys = schema.allOf.map((b) => b.if.properties.product_key.const).sort();
    assert.deepEqual(products.map((p) => p.key), keys);
    const cats = new Set(schema.properties.category.enum);
    for (const p of products) {
      assert.ok(cats.has(p.category), `${p.key}: category ${p.category} is in the enum`);
      assert.ok(p.categories.includes(p.category), `${p.key}: seeded category is one the schema allows`);
      assert.ok(p.label && p.label.length > 2, `${p.key}: human label`);
    }
  });

  it('spec contracts are typed and consistent (required ⊆ props, rules target real keys)', () => {
    for (const p of products) {
      for (const req of p.required) assert.ok(p.props[req], `${p.key}: required ${req} has a prop`);
      for (const [key, prop] of Object.entries(p.props)) {
        assert.ok(
          ['string', 'number', 'integer', 'boolean', 'array'].includes(prop.type),
          `${p.key}.${key}: type`,
        );
        assert.ok(prop.label, `${p.key}.${key}: label`);
        if (prop.enum) assert.ok(prop.enum.length > 0, `${p.key}.${key}: enum not empty`);
      }
      for (const rule of p.rules) {
        assert.ok(p.props[rule.key], `${p.key}: rule target ${rule.key} is a prop`);
      }
    }
  });

  it('the dual-category product seeds under conveying_accessories (founder call)', () => {
    const belt = byKey.get('transmission_belt');
    assert.ok(belt, 'transmission_belt present');
    assert.deepEqual(belt.categories.slice().sort(), ['conveying_accessories', 'power_transmission_elements']);
    assert.equal(belt.category, 'conveying_accessories');
  });

  it('seed migration writes products + spec-ask rows with deterministic ids', () => {
    const productRows = seedSql.match(/^\('pi_/gm) ?? [];
    const guideRows = seedSql.match(/^\('kg_/gm) ?? [];
    assert.equal(productRows.length, products.length, 'one ProductItem row per product');
    const specCount = products.reduce((n, p) => n + Object.keys(p.props).length, 0);
    assert.equal(guideRows.length, specCount, 'one KypGuide row per spec key');
    assert.ok(seedSql.includes('ON CONFLICT(id) DO UPDATE'), 're-runnable (upsert, never INSERT OR REPLACE)');
    assert.ok(!/INSERT OR REPLACE/i.test(seedSql), 'never INSERT OR REPLACE');
  });
});

describe('kyp schema v2 — the spec typechecker the writes run through', () => {
  let kyp;
  before(async () => {
    const mod = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, 'src', 'automations', 'product-line', 'kyp-schema.ts'))).href);
    kyp = mod;
  });

  it('resolves a quote row to its schema product (seeded id, then label)', () => {
    assert.equal(kyp.resolveProductKey('pi_milling_fabric'), 'milling_fabric');
    assert.equal(kyp.resolveProductKey('some-uuid', 'Milling Fabric'), 'milling_fabric');
    assert.equal(kyp.resolveProductKey('some-uuid', 'Not A Product'), null);
  });

  it('accepts a clean spec set and rejects enum / range / if-then violations', () => {
    assert.equal(kyp.validateSpecs('milling_fabric', { grade: 'GG', grade_number: 10, width_cm: 115 }).ok, true);
    const badEnum = kyp.validateSpecs('milling_fabric', { grade: 'ZZ', grade_number: 10, width_cm: 115 });
    assert.equal(badEnum.ok, false);
    assert.match(badEnum.errors[0].message, /must be one of/);
    const badConditional = kyp.validateSpecs('milling_fabric', { grade: 'GG', grade_number: 5, width_cm: 115 });
    assert.equal(badConditional.ok, false);
    assert.match(badConditional.errors[0].message, /at least 6/);
    const badType = kyp.validateSpecs('milling_fabric', { grade: 'GG', grade_number: 'ten', width_cm: 115 });
    assert.equal(badType.ok, false);
  });

  it('reports required-but-empty specs and keeps brand inside the spec document', () => {
    const empty = kyp.validateSpecs('milling_fabric', {});
    // Keys, not labels — prepareRateSpecs (rate-specs.ts) maps them to questions
    // for missingSpecs so the UI can show the wording.
    assert.deepEqual(empty.missing, ['grade', 'grade_number', 'width_cm']);
    const withBrand = kyp.validateSpecs('milling_fabric', { grade: 'GG', grade_number: 10, width_cm: 115, brand: 'PIX' });
    assert.equal(withBrand.ok, true);
    assert.equal(withBrand.specs.brand, 'PIX');
    const unknown = kyp.validateSpecs('milling_fabric', { made_up_key: 'x' });
    assert.equal(unknown.ok, false);
  });

  it('envelope: enum unit, integer moq, positive price, lead-time range', () => {
    const clean = kyp.validateEnvelope({ unit: 'pcs', moq: '1', pricePerUnit: 100, deliveryDays: 1, deliveryMaxDays: 2, quotedAt: '2026-11-23' });
    assert.deepEqual(clean.errors, []);
    const badUnit = kyp.validateEnvelope({ unit: 'per mm' });
    assert.equal(badUnit.errors.length, 1);
    assert.deepEqual(kyp.validateEnvelope({}).missing, ['unit_of_sale', 'moq', 'price_per_unit', 'delivery_time_days', 'date_added']);
    const badRange = kyp.validateEnvelope({ deliveryDays: 3, deliveryMaxDays: 1 });
    assert.equal(badRange.errors.length, 1);
  });

  it('spec index rows carry typed numeric values', () => {
    const rows = kyp.specIndexRows({ width_mm: 1000, brand: 'PIX', grade: 'GG' });
    assert.deepEqual(rows.find((r) => r.attrKey === 'width_mm'), { attrKey: 'width_mm', valueText: '1000', valueNum: 1000 });
    assert.equal(rows.find((r) => r.attrKey === 'brand').valueNum, null);
  });
});

const exportMod = await import(
  pathToFileURL(bundleToFile(join(BACKEND_DIR, 'src', 'automations', 'product-line', 'schema-export.ts'))).href
);
const buildKypSchema = exportMod.buildKypSchema;

describe('kyp export — D1 catalogue → downloadable schema', () => {

  const catalog = {
    categories: ['plansifter_accessories', 'conveying_accessories'],
    products: [
      {
        id: 'pi_milling_fabric', key: 'milling_fabric', label: 'Milling Fabric',
        category: 'plansifter_accessories', categories: ['plansifter_accessories'],
        aliases: ['nylon mesh'], ask: ['Grade?'],
        props: {
          grade: { type: 'string', label: 'Grade', enum: ['GG', 'XXX'] },
          grade_number: { type: 'integer', label: 'Grade Number', min: 1, max: 300 },
          width_cm: { type: 'number', label: 'Width (cm)', gt: 0 },
        },
        required: ['grade', 'grade_number', 'width_cm'],
        rules: [{ whenKey: 'grade', whenValue: 'GG', key: 'grade_number', min: 6, max: 74 }],
        active: true,
      },
      {
        id: 'pi_transmission_belt', key: 'transmission_belt', label: 'Transmission Belt',
        category: 'conveying_accessories',
        categories: ['power_transmission_elements', 'conveying_accessories'],
        aliases: ['flat drive patta'], ask: [],
        props: { width_mm: { type: 'number', label: 'Width (mm)', gt: 0 } },
        required: ['width_mm'], rules: [], active: true,
      },
    ],
  };

  it('rebuilds a loadable v2-shaped schema (branches, refs, categories)', () => {
    const out = buildKypSchema(catalog);
    assert.equal(out.$schema, 'http://json-schema.org/draft-07/schema#');
    assert.equal(out.properties.product_key.enum.length, 2);
    assert.deepEqual(out.properties.category.enum, catalog.categories);
    assert.equal(out.allOf.length, 2);
    for (const branch of out.allOf) {
      const key = branch.if.properties.product_key.const;
      assert.ok(out.definitions[key], `${key}: definition`);
      assert.equal(branch.then.properties.specs.$ref, `#/definitions/${key}`);
      const cat = branch.then.properties.category;
      assert.ok(cat.const || cat.enum, `${key}: category bound`);
    }
    const belt = out.definitions.transmission_belt;
    assert.deepEqual(belt['x-aliases'], ['flat drive patta']);
    assert.deepEqual(belt.required, ['width_mm']);
    const fabric = out.definitions.milling_fabric;
    assert.deepEqual(fabric.properties.grade.enum, ['GG', 'XXX']);
    assert.equal(fabric.properties.width_cm.exclusiveMinimum, 0);
    assert.equal(fabric.allOf[0].if.properties.grade.const, 'GG');
    assert.equal(fabric.allOf[0].then.properties.grade_number.minimum, 6);
    for (const req of ['category', 'product_key', 'aliases', 'specs', 'price_per_unit']) {
      assert.ok(out.required.includes(req), `required ${req}`);
    }
  });
});

const filters = await import(
  pathToFileURL(bundleToFile(join(FRONTEND_SRC, 'product-line', 'filters.ts'), { alias: { '@': FRONTEND_SRC } })).href
);

describe('rates sheet filters — server vocabulary + query building', () => {

  it('caps the page at 500 rows and repeats ?spec= per filter', () => {
    const q = new URLSearchParams(
      filters.toQuery(
        {
          ...filters.EMPTY_FILTERS,
          productId: 'pi_x',
          priceMin: '100',
          missing: "any",
          specs: [
            { key: 'brand', op: 'eq', value: 'PIX' },
            { key: 'width_mm', op: 'gte', value: '1000' },
            { key: 'material', op: 'in', value: 'ss, gi' },
            { key: 'thickness_mm', op: 'between', value: '2', value2: '5' },
          ],
        },
        2,
        5000,
      ),
    );
    assert.equal(q.get('limit'), '500', 'page size clamps to the sheet cap');
    assert.equal(q.get('page'), '2');
    assert.equal(q.get('productId'), 'pi_x');
    assert.equal(q.get('priceMin'), '100');
    assert.equal(q.get('missing'), '1');
    assert.deepEqual(q.getAll('spec'), [
      'brand:PIX',
      'width_mm:>=1000',
      'material:in:ss,gi',
      'thickness_mm:2..5',
    ]);
  });

  it('names every missing required field (specs from the live contract + envelope)', () => {
    const missing = filters.missingFields(
      { attrValues: { grade: 'GG' }, unit: '', moq: '', pricePerUnit: null, deliveryDays: null, quotedAt: '' },
      { props: { grade: { label: 'Grade' }, grade_number: { label: 'Grade Number' } }, required: ['grade', 'grade_number'] },
    );
    assert.deepEqual(missing, [
      'Grade Number',
      'Unit of sale',
      'MOQ',
      'Price per unit',
      'Delivery time',
      'Date added',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-11-23 v2: spec defaults, paste-import envelope, and one missing-field
// definition shared by the sheet and the drawer.
// ─────────────────────────────────────────────────────────────────────────────
const specDefault = await import(
  pathToFileURL(bundleToFile(join(BACKEND_DIR, 'src', 'automations', 'product-line', 'spec-default.ts'))).href
);
const importParse = await import(
  pathToFileURL(bundleToFile(join(BACKEND_DIR, 'src', 'automations', 'product-line', 'rate-import-parse.ts'))).href
);
const beMissing = await import(
  pathToFileURL(
    bundleToFile(join(BACKEND_DIR, 'src', 'automations', 'product-line', 'service-parts', 'missing.ts')),
  ).href
);

describe('spec defaults — declared once, enforced everywhere', () => {
  it('the generator carries the schema default into the catalogue and the seed', () => {
    const catalog = readFileSync(join(BACKEND_DIR, 'src', 'automations', 'product-line', 'kyp-catalog.ts'), 'utf8');
    const seed = readFileSync(join(BACKEND_DIR, 'migrations', '0156_kyp_catalog_v2_seed.sql'), 'utf8');
    assert.ok(/"default":/.test(catalog), 'compiled props keep the schema default');
    assert.ok(seed.includes('defaultValue'), 'the seed writes the defaultValue column');
    const parsed = JSON.parse(`[${catalog.split('export const KYP_PRODUCTS: KypProduct[] = [')[1].split('];')[0].trim().replace(/,$/, '')}]`);
    const withDefault = parsed.flatMap((p) => Object.entries(p.props)).filter(([, prop]) => prop.default !== undefined);
    assert.ok(withDefault.length >= 40, `expected the schema defaults to survive (got ${withDefault.length})`);
  });

  it('keeps the value type and refuses an enum member that does not exist', () => {
    assert.equal(specDefault.normalizeDefaultValue('pu', { type: 'string', enum: ['pu', 'gg'] }), '"pu"');
    assert.equal(specDefault.normalizeDefaultValue(5, { type: 'integer' }), '5');
    assert.equal(specDefault.normalizeDefaultValue('true', { type: 'boolean' }), 'true');
    assert.equal(specDefault.normalizeDefaultValue('', { type: 'string' }), null);
    assert.throws(
      () => specDefault.normalizeDefaultValue('XX', { type: 'string', enum: ['GG', 'XXX'] }),
      /not one of/,
    );
    assert.equal(specDefault.parseStoredDefault('"GG"'), 'GG');
    assert.equal(specDefault.parseStoredDefault('75'), 75);
    assert.equal(specDefault.parseStoredDefault(null), undefined);
  });

  it('the export round-trips the default onto the property', () => {
    const out = buildKypSchema({
      categories: ['plansifter_accessories'],
      products: [{
        id: 'pi_x', key: 'x', label: 'X', category: 'plansifter_accessories', categories: [],
        aliases: [], ask: [], required: [], rules: [], active: true,
        props: { grade: { type: 'string', label: 'Grade', enum: ['GG', 'XXX'], default: 'GG' } },
      }],
    });
    assert.equal(out.definitions.x.properties.grade.default, 'GG');
  });
});

describe('paste-import envelope — what a chat agent returns', () => {
  it('reads a fenced block, and tolerates prose around it', () => {
    const fenced = "Here you go:\n```json\n{\"rates\":[{\"product_key\":\"x\"}]}\n```\nAnything else?";
    assert.deepEqual(importParse.extractJsonPayload(fenced), { rates: [{ product_key: 'x' }] });
    const prose = 'Sure — {"rates":[{"product_key":"y"}]} done';
    assert.deepEqual(importParse.extractJsonPayload(prose), { rates: [{ product_key: 'y' }] });
    assert.throws(() => importParse.extractJsonPayload('not json at all'), /not valid JSON/);
    assert.throws(() => importParse.extractJsonPayload(''), /paste the JSON/);
  });

  it('accepts the three shapes and rejects anything else', () => {
    assert.equal(importParse.rowsOf({ rates: [1, 2] }).length, 2);
    assert.equal(importParse.rowsOf([1, 2, 3]).length, 3);
    assert.equal(importParse.rowsOf({ product_key: 'x' }).length, 1);
    assert.throws(() => importParse.rowsOf({ nothing: true }), /expected \{"rates"/);
  });
});

describe('missing fields — server and client never disagree', () => {
  const products = {
    props: { grade: { label: 'Grade' }, grade_number: { label: 'Grade Number' } },
    required: ['grade', 'grade_number'],
  };
  const cases = [
    { label: 'nothing answered', rate: { attrValues: {}, unit: '', moq: '', pricePerUnit: null, deliveryDays: null, quotedAt: '' } },
    { label: 'spec gap only', rate: { attrValues: { grade: 'GG' }, unit: 'meter', moq: '100', pricePerUnit: 120, deliveryDays: 5, quotedAt: '2026-11-20' } },
    { label: 'envelope gap only', rate: { attrValues: { grade: 'GG', grade_number: 40 }, unit: '', moq: null, pricePerUnit: 0, deliveryDays: 0, quotedAt: '2026-11-20' } },
    { label: 'complete', rate: { attrValues: { grade: 'GG', grade_number: 40 }, unit: 'meter', moq: '100', pricePerUnit: 120, deliveryDays: 5, quotedAt: '2026-11-20' } },
  ];

  it('returns the same labels in the same order as the frontend', () => {
    for (const c of cases) {
      assert.deepEqual(
        beMissing.missingFieldsFor(c.rate, products),
        filters.missingFields(c.rate, products),
        c.label,
      );
    }
  });

  it('a complete quote misses nothing', () => {
    assert.deepEqual(beMissing.missingFieldsFor(cases[3].rate, products), []);
    assert.equal(beMissing.missingFieldsFor(cases[0].rate, products).length, 7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-11-23 v3: batches, two-phase import, is_new_vendor.
// Pure assertions only — the D1 lifecycle is covered by the live smoke curl.
// ─────────────────────────────────────────────────────────────────────────────
const previewRows = await import(
  pathToFileURL(bundleToFile(join(BACKEND_DIR, 'src', 'automations/product-line', 'rate-import-parse.ts'))).href
);

describe('batch log + two-phase import', () => {
  const read = (p) => readFileSync(join(BACKEND_DIR, p), 'utf8');

  it('the batch table, the trace column and the index exist as a re-runnable migration', () => {
    const mig = read('migrations/0160_product_rate_batch.sql');
    assert.ok(/CREATE TABLE IF NOT EXISTS RateBatch/.test(mig), 'RateBatch is created idempotently');
    assert.ok(/idx_vendorrate_batch/.test(mig), 'quotes are indexed by batch');
    for (const col of ['rowCount', 'createdCount', 'failedCount', 'vendorNames', 'failures', 'status']) {
      assert.ok(mig.includes(col), `RateBatch carries ${col}`);
    }
    const schema = read('prisma/schema.prisma');
    assert.ok(/model RateBatch \{/.test(schema), 'prisma knows the trace table');
    assert.ok(/batchId\s+String\?/.test(schema), 'VendorRate keeps the trace column');
  });

  it('the importer is two-phase and never creates a vendor without a decision', () => {
    const src = read('src/automations/product-line/rate-import.ts');
    assert.ok(/export async function previewImport/.test(src), 'preview phase exists');
    assert.ok(/RateBatch|createBatch/.test(src), 'imports are stamped with a batch');
    // the only vendor.create call sits behind an explicit `create` decision
    const creates = src.split('vendor.create').length - 1;
    assert.equal(creates, 1, 'exactly one vendor-creation site');
    assert.ok(/decision.action === 'map'/.test(src), 'map-to-existing is honoured');
    assert.ok(/vendor skipped/.test(src), 'skip rejects the row');
    assert.ok(/vendor not confirmed/.test(src), 'silence is a failure, never a silent create');
  });

  it('a row flagged is_new_vendor is only a CANDIDATE (review decides)', () => {
    const src = read('src/automations/product-line/rate-import.ts');
    assert.ok(/is_new_vendor === true/.test(src), 'honours the agent flag');
    assert.ok(/newVendors/.test(src) && /isNewVendor/.test(src), 'candidates are surfaced for review');
    assert.ok(/not in the master and the agent did not mark it is_new_vendor/.test(src), 'unflagged unknown vendors fail loudly');
  });

  it('the prompt teaches the flag and the vendor fields', () => {
    const src = read('src/automations/product-line/prompt.ts');
    assert.ok(src.includes('"is_new_vendor": false'), 'output example carries the flag');
    assert.ok(/is_new_vendor": true/.test(src), 'rule tells the model when to set it true');
    assert.ok(/vendor_location/.test(src) && /contact_number_1/.test(src), 'new-vendor fields are named');
  });

  it('the rates sheet puts completeness next to the vendor and can filter a batch', () => {
    const sheet = readFileSync(join(FRONTEND_SRC, 'components', 'product-line', 'RatesSheet.tsx'), 'utf8');
    const header = sheet.slice(sheet.indexOf('["Product"'), sheet.indexOf('].map((h, i)'));
    assert.ok(header.indexOf('Completeness') > 0, 'completeness is a column');
    assert.ok(header.indexOf('Completeness') < header.indexOf('Brand'), 'completeness sits right after the vendor');
    assert.ok(/Complete/.test(sheet), 'complete rows read Complete with a tick');
    assert.ok(/rating the field|Needs \{fields.length\}/.test(sheet), 'the hover card explains what is missing');
    const filters = readFileSync(join(FRONTEND_SRC, 'product-line', 'filters.ts'), 'utf8');
    assert.ok(/batchId: string/.test(filters) && /p\.set\("batchId"/.test(filters), 'batch is a first-class filter');
    const be = read('src/automations/product-line/service-parts/rates-page.ts');
    assert.ok(/batchId\?: string/.test(be) && /r\.batchId = \?/.test(be), 'server filters by batch');
  });

  it('every product-line delete goes through a confirm panel', () => {
    const dir = join(FRONTEND_SRC, 'components', 'product-line');
    const expectConfirm = {
      'RateDrawer.tsx': 'Delete this vendor rate?',
      'SpecsEditor.tsx': 'Remove this spec?',
      'VendorsTab.tsx': 'Delete this vendor?',
      'ProductEditor.tsx': 'Delete this product?',
      'CategoryManager.tsx': 'Remove this category?',
      'BatchLogDrawer.tsx': 'Delete this batch?',
    };
    for (const [file, title] of Object.entries(expectConfirm)) {
      const src = readFileSync(join(dir, file), 'utf8');
      assert.ok(src.includes('ConfirmDialog'), `${file} imports the shared confirm dialog`);
      assert.ok(src.includes(title), `${file} asks "${title}"`);
    }
  });
});
