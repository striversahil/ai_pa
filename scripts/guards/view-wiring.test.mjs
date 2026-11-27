// view-wiring.test.mjs — Guard: every sidebar view has a rendered branch.
//
// The dashboard is one static route with History-API views: `nav.tsx` owns the
// list, `page.tsx` owns the switch. A view added to the nav but never rendered
// is not a crash — it renders an EMPTY <main>, which reads as "the frontend is
// blank" to whoever clicked it (that is exactly how /integrations shipped).
// This guard fails on any nav view with no branch, on a dynamic() import whose
// module or default export is missing, and on a lazily imported component
// that is declared but never mounted.
//
// Run: `node --test "scripts/guards/*.test.mjs"` or `node scripts/guards/view-wiring.test.mjs`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { FRONTEND_SRC } from './_bundle.mjs';

const PAGE = join(FRONTEND_SRC, 'app', 'page.tsx');
const NAV = join(FRONTEND_SRC, 'components', 'layout', 'nav.tsx');
const page = readFileSync(PAGE, 'utf8');
const nav = readFileSync(NAV, 'utf8');

/** Views the sidebar advertises (NAV_ITEMS entries only — not the type union). */
function navViews() {
  const block = nav.slice(nav.indexOf('NAV_ITEMS'), nav.indexOf('MOBILE_NAV_ITEMS'));
  return [...block.matchAll(/view:\s*"([a-z-]+)"/g)].map((m) => m[1]);
}

describe('every nav view renders', () => {
  const views = navViews();

  it('finds the sidebar views', () => {
    assert.ok(views.length >= 12, `parsed ${views.length} views from nav.tsx`);
    assert.ok(views.includes('integrations'));
  });

  it('page.tsx switches on each one', () => {
    const missing = views.filter((v) => !page.includes(`activeView === "${v}"`));
    assert.deepEqual(missing, [], `nav views with no render branch in page.tsx: ${missing.join(', ')}`);
  });
});

describe('lazy views are real and mounted', () => {
  const lazy = [...page.matchAll(/const (\w+) = dynamic\(\(\) => import\("([^"]+)"\)/g)].map((m) => ({
    name: m[1],
    spec: m[2],
  }));

  it('declares the lazy views', () => {
    assert.ok(lazy.length >= 10, `parsed ${lazy.length} dynamic imports`);
  });

  it('every module resolves with a default export', () => {
    for (const { name, spec } of lazy) {
      const file = ['', '.tsx', '.ts'].map((ext) => resolve(dirname(PAGE), spec + ext)).find((p) => existsSync(p));
      assert.ok(file, `${name}: ${spec} does not resolve to a file`);
      assert.match(readFileSync(file, 'utf8'), /export default/, `${name}: ${spec} has no default export (dynamic() renders nothing without one)`);
    }
  });

  it('every lazy view is mounted', () => {
    const unmounted = lazy.filter(({ name }) => !page.includes(`<${name}`));
    assert.deepEqual(unmounted.map((l) => l.name), [], 'declared but never rendered (blank view)');
  });
});
