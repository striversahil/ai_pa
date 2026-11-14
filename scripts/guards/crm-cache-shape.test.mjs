// crm-cache-shape.test.mjs — Guard: the dispatch-floor read cache is KV-safe.
//
// 2026-11-14 incident: cachedFloorRows cached a Map (itemsBySo). KV stores
// JSON, so a Map round-tripped to `{}` (no `.get`) and EVERY cache hit threw
// → HTTP 500 on the floor until TTL expiry. The contract is now: the scan is
// `{ rows, items: Record }` — plain JSON. This guard drives the REAL wrappers
// through a fake string-storing KV (the same JSON path production takes) and
// fails if a hit ever diverges from what compute produced.
//
// The entry is bundled from self-contained copies (the real sources with the
// two Node-hostile imports rewritten): shared/cache → stub logger (the real
// one pulls pino + env-validated config, which throws without a full backend
// env, and logging is irrelevant to a cache-shape guard).
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { BACKEND_DIR, bundleToFile } from './_bundle.mjs';

const TMP = join(BACKEND_DIR, '.guard-tmp', 'crm-cache');
mkdirSync(TMP, { recursive: true });

const SRC = join(BACKEND_DIR, 'src');
const rewrite = (from, to, anchor) => {
  const src = readFileSync(from, 'utf8');
  assert.ok(src.includes(anchor), `guard rewrite anchor moved: ${anchor}`);
  return src.replaceAll(anchor, to);
};
// Order matters: shared-cache first, entry points at the copy.
writeFileSync(
  join(TMP, 'shared-cache.ts'),
  rewrite(join(SRC, 'shared', 'cache.ts'), `from './logger-stub.mjs'`, `from './logger'`),
);
writeFileSync(join(TMP, 'logger-stub.mjs'), `export const logger = { warn(){}, debug(){}, info(){}, error(){} };\n`);
const mod = await import(bundleToFile(
  (() => {
    writeFileSync(
      join(TMP, 'crm-cache-entry.ts'),
      rewrite(
        join(SRC, 'modules', 'crm', 'store-parts', 'cache.ts'),
        `from './shared-cache.ts'`,
        `from '../../../shared/cache'`,
      ),
    );
    return join(TMP, 'crm-cache-entry.ts');
  })(),
  { outDir: join(TMP, 'out') },
));
after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best-effort */ } });

/** String-storing fake KV — values cross the JSON boundary like production. */
const stringKv = () => {
  const store = new Map();
  return {
    get: async (k) => (store.has(k) ? String(store.get(k)) : null),
    put: async (k, v) => { store.set(k, String(v)); },
    delete: async (k) => { store.delete(k); },
    list: async ({ prefix = '' } = {}) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
      cursor: '',
    }),
  };
};

describe('crm floor cache is KV-JSON-safe', () => {
  it('a cache hit returns exactly what compute produced', async () => {
    mod.initCache({ CACHE_KV: stringKv() });
    await mod.invalidateCrmFloorCache();
    const scan = { rows: [{ id: 'o1' }], items: { o1: [{ id: 'i1' }] } };
    const first = await mod.cachedFloorRows(async () => scan);
    assert.deepEqual(first, scan);
    const second = await mod.cachedFloorRows(async () => {
      throw new Error('must not recompute on a hit');
    });
    assert.deepEqual(second, scan);
    assert.equal(second.items.o1[0].id, 'i1');
  });

  it('invalidation drops rows and summaries', async () => {
    mod.initCache({ CACHE_KV: stringKv() });
    await mod.invalidateCrmFloorCache();
    await mod.cachedFloorRows(async () => ({ rows: [], items: {} }));
    await mod.cachedFloorSummary('all', async () => ({ total: 1 }));
    await mod.invalidateCrmFloorCache();
    let recomputed = 0;
    await mod.cachedFloorRows(async () => { recomputed++; return { rows: [], items: {} }; });
    await mod.cachedFloorSummary('all', async () => { recomputed++; return { total: 1 }; });
    assert.equal(recomputed, 2);
  });
});
