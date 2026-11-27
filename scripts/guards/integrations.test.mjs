// integrations.test.mjs — Guard: one ingestion pipeline, one mapping DSL.
//
// The hub must stay FLEXIBLE without becoming unsafe: a service is a data
// mapping (never code), the public door is AUTH_EXEMPT but token-gated, D1
// never stores the key, and the console is root-only. This guard fails on any
// of those drifting, and on the panel losing the "add a custom service" path.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/integrations.test.mjs`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

const catalog = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'integrations', 'catalog.ts')));
const mapping = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'integrations', 'mapping.ts')));

const read = (p) => readFileSync(join(BACKEND_DIR, p), 'utf8');

describe('catalog: built-in services', () => {
  it('every entry is addable or explicitly native', () => {
    for (const c of catalog.BUILTIN_CONNECTORS) {
      assert.ok(c.key && c.name, 'key + name required');
      assert.ok(c.mapping && typeof c.mapping === 'object', `${c.key} needs a mapping preset`);
    }
    const addable = catalog.addableConnectors().map((c) => c.key);
    assert.ok(addable.includes('tally'), 'Tally is the first live connector');
    assert.ok(addable.includes('generic'), 'a custom webhook must always be addable');
    assert.ok(!addable.includes('whatsapp'), 'WhatsApp is native — never duplicated');
  });
});

describe('mapping DSL is data, not code', () => {
  it('resolves dot and index paths', () => {
    assert.equal(mapping.getPath({ a: { b: [{ c: 7 }] } }, 'a.b[0].c'), 7);
    assert.equal(mapping.getPath({ a: 1 }, 'a.b.c'), undefined);
  });

  it('maps an IndiaMART-shaped lead', () => {
    const spec = catalog.builtinConnector('indiamart').mapping;
    const out = mapping.applyMapping({
      UNIQUE_QUERY_ID: 'Q1', SUBJECT: 'Milling machine', QUERY: 'Need 5 ton roller',
      COMPANY_NAME: 'G Mart', NAME: 'Ravi', MOBILE: '+91 90000 00000', CITY: 'Mathura',
      QUERY_TIME: '2026-11-27 10:00:00',
    }, spec);
    assert.equal(out.events.length, 1);
    const e = out.events[0];
    assert.equal(e.kind, 'lead');
    assert.equal(e.externalId, 'Q1');
    assert.equal(e.company, 'G Mart');
    assert.equal(e.phone, '+919000000000');
    assert.equal(e.city, 'Mathura');
    assert.ok(e.summary.includes('5 ton roller'));
  });

  it('groups an array payload into events', () => {
    const out = mapping.applyMapping({ leads: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }, {
      itemsPath: 'leads', fields: { externalId: 'id', contactName: 'name' }, eventKind: 'lead',
    });
    assert.deepEqual(out.events.map((e) => e.externalId), ['a', 'b']);
  });

  it('falls back to a stable id so retries never duplicate', () => {
    const spec = { fields: { title: 'subject' } };
    const a = mapping.applyMapping({ subject: 'x', n: 1 }, spec).events[0].externalId;
    const b = mapping.applyMapping({ subject: 'x', n: 1 }, spec).events[0].externalId;
    assert.equal(a, b);
    assert.notEqual(a, mapping.applyMapping({ subject: 'x', n: 2 }, spec).events[0].externalId);
  });
});

describe('storage + door invariants', () => {
  const sql = read('migrations/0180_integration_hub.sql');
  const ctx = read('src/worker/context.ts');
  const admin = read('src/worker/routes/integrations.ts');
  const storeSrc = read('src/modules/integrations/store.ts');

  it('dedupes every event per source', () => {
    assert.match(sql, /UNIQUE INDEX IF NOT EXISTS "IntegrationEvent_dedupe"[^;]*\("sourceId", "externalId"\)/s);
  });

  it('keeps the key out of D1', () => {
    assert.match(sql, /"tokenHash"/);
    assert.doesNotMatch(sql, /"token" TEXT/);
    assert.match(storeSrc, /tokenHash/);
  });

  it('the webhook door is AUTH_EXEMPT, the console is root-only', () => {
    assert.match(ctx, /'\/api\/ingest\/'/);
    assert.match(admin, /Root only/);
  });

  it('custom services are a panel path, not a deploy', () => {
    assert.match(admin, /\/api\/integrations\/connectors/);
    assert.match(admin, /\/api\/integrations\/preview/);
  });
});

describe('file budget', () => {
  const files = [
    'src/modules/integrations/types.ts', 'src/modules/integrations/mapping.ts',
    'src/modules/integrations/catalog.ts', 'src/modules/integrations/store.ts',
    'src/modules/integrations/service.ts', 'src/modules/integrations/adapters/tally.ts',
    'src/worker/routes/ingest.ts', 'src/worker/routes/integrations.ts',
  ];
  it('stays under 400 lines', () => {
    for (const f of files) {
      const lines = read(f).split('\n').length;
      assert.ok(lines <= 400, `${f} is ${lines} lines`);
    }
  });
});
