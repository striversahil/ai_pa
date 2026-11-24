// sales-board-cache.test.mjs — the Sales leaderboard's load path (2026-11-21).
//
// What this locks (all founder-visible behaviour, all previously broken):
//   1. One page load must NOT run the full aggregation once per region. Region
//      drills are served by service-parts/drill.ts from their own cache.
//   2. Invalidation is a REVISION BUMP (one small put), never a prefix delete
//      over every cached variant — that prefix delete ran on every estimate
//      write AND every 5-minute NeoDove refresh, which is why the board cache
//      never survived a working day.
//   3. The roster sync (a write) never runs inside the payload compute.
//   4. The NeoDove refresh does not invalidate anything when its rows are
//      unchanged.
//   5. The frontend makes ONE dashboard request that already carries every
//      region's pipeline (`follow_ups=1`); no per-region prefetch fan-out.
//
// Source-text assertions on purpose: these modules import prisma at load time,
// so bundling them into a unit test would drag the D1 shim in. The behaviour
// they protect is structural (which code path is reachable), which is exactly
// what reading the source can prove.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR, FRONTEND_SRC } from './_bundle.mjs';

const read = (...parts) => readFileSync(join(...parts), 'utf8');

const IO = join(BACKEND_DIR, 'src', 'automations', 'telecalling', 'service-parts', 'io.ts');
const DRILL = join(BACKEND_DIR, 'src', 'automations', 'telecalling', 'service-parts', 'drill.ts');
const CACHE = join(BACKEND_DIR, 'src', 'shared', 'cache.ts');
const EST_CACHE = join(BACKEND_DIR, 'src', 'shared', 'estimates-cache.ts');
const NEO = join(BACKEND_DIR, 'src', 'automations', 'neodove-telecaller-report', 'index-parts', 'io.ts');
const NEO_REFRESH = join(BACKEND_DIR, 'src', 'automations', 'neodove-refresh-parts', 'io.ts');
const DASHBOARD = join(FRONTEND_SRC, 'components', 'TelecallingDashboard.tsx');
const MIGRATION = join(BACKEND_DIR, 'migrations', '0159_sales_board_indexes.sql');

/** The body of `computeTelecallingDashboardData` (the expensive aggregation). */
function computeBody() {
  const src = read(IO);
  const start = src.indexOf('export async function computeTelecallingDashboardData');
  assert.ok(start > 0, 'computeTelecallingDashboardData must exist');
  const end = src.indexOf('\n/** Daily manager section', start);
  assert.ok(end > start, 'compute body must be delimited by the daily-section helper');
  return src.slice(start, end);
}

describe('sales board — region drills never pay for the aggregation', () => {
  it('a ?region=/?agent= request is served by the drill module, before any compute', () => {
    const src = read(IO);
    const drillAt = src.indexOf('const wantsDrill');
    const computeAt = src.indexOf('computeTelecallingDashboardData(ctx)');
    assert.ok(drillAt > 0, 'getTelecallingDashboardData must branch on a drill request');
    assert.ok(drillAt < computeAt, 'the drill branch must run BEFORE the aggregation is invoked');
    assert.match(src, /buildRegionDrill\(\{ regionId: scope\.regionId/, 'the drill must be built by drill.ts');
  });

  it('the aggregation itself no longer handles regions at all', () => {
    const body = computeBody();
    assert.ok(!/Region drill-down/.test(body), 'the old in-compute drill branch must be gone');
    assert.ok(!/followUpEsts/.test(body), 'the drill estimate read must not live in the aggregation');
    assert.ok(!body.includes("'sales-leaderboard-region'"), 'the drill payload must not be assembled by the aggregation');
  });

  it('the drill reads only what it renders (no accepted/declined/target work)', () => {
    const src = read(DRILL);
    assert.ok(src.includes("opts.region === null ? { status: 'sent' } : { region: opts.region, status: 'sent' }"));
    assert.ok(!src.includes('loadAcceptedSnapshot'), 'a drill must not build the accepted snapshot');
    assert.ok(!src.includes('loadDeclinedSnapshot'), 'a drill must not build the declined snapshot');
    assert.ok(!src.includes('classifyClients'), 'a drill must not classify clients');
    assert.ok(!src.includes('buildRegionTargets'), 'a drill must not rebuild the target ledger');
  });

  it('every region\'s pipeline ships with the board (one request)', () => {
    assert.ok(existsSync(DRILL));
    assert.match(read(DRILL), /export async function buildAllRegionFollowUps/);
    const src = read(IO);
    assert.match(src, /payload\.regionFollowUps = await cached/, 'the board must attach regionFollowUps when asked');
    assert.ok(!/:region:\$\{regionKey\}/.test(src), 'the region must not fork the board cache key again');
  });
});

describe('sales board — invalidation is one revision bump', () => {
  it('cache.ts exposes rev helpers', () => {
    const src = read(CACHE);
    for (const fn of ['cacheRev', 'cacheRevs', 'bumpRev']) {
      assert.match(src, new RegExp(`export async function ${fn}\\(`), `${fn} missing from shared/cache.ts`);
    }
  });

  it('estimate writes bump a revision instead of prefix-deleting the board', () => {
    const src = read(EST_CACHE);
    assert.ok(src.includes("bumpRev('est')"), 'invalidateDerivedEstimateCaches must bump the est revision');
    assert.ok(!src.includes("cacheDelPrefix('telecalling:dashboard')"), 'the prefix delete must be gone (it wiped every variant)');
  });

  it('the NeoDove refresh bumps a revision instead of prefix-deleting the board', () => {
    const src = read(NEO);
    assert.ok(src.includes("bumpRev('neo')"));
    assert.ok(!src.includes("cacheDelPrefix('telecalling:dashboard')"));
  });

  it('the board cache key folds in the revisions', () => {
    const src = read(IO);
    assert.match(src, /const revs = await cacheRevs\(\['est', 'neo'\]\)/);
    assert.match(src, /const cacheKey = `telecalling:dashboard:\$\{revs\}:/);
  });
});

describe('sales board — writes stay out of the read path', () => {
  it('the aggregation never syncs the roster', () => {
    assert.ok(!computeBody().includes('syncTelecallersFromNeodove'), 'a GET must not upsert the roster per compute');
    const src = read(IO);
    assert.match(src, /cached\('telecalling:roster_sync', 10 \* 60 \* 1000/, 'the sync must be bounded to once per 10 minutes');
  });

  it('the log-only core shadow compare is bounded too', () => {
    assert.match(read(IO), /cached\('telecalling:sales_shadow', 30 \* 60 \* 1000/);
  });

  it('an idle NeoDove refresh writes nothing and invalidates nothing', () => {
    const src = read(NEO_REFRESH);
    assert.ok(src.includes('rowsUnchanged'), 'the refresh must compare the stored rows');
    assert.match(src, /if \(rowsUnchanged\) \{[\s\S]{0,1500}?unchanged: true/, 'unchanged rows must short-circuit before the write + invalidate');
  });
});

describe('sales board — the board query is one request', () => {
  it('the dashboard asks for the board WITH every region pipeline', () => {
    const src = read(DASHBOARD);
    // The board carries its filter window (preset OR custom from/to) and every
    // region's pipeline in ONE request — never one request per slice.
    assert.ok(src.includes('?${periodQuery}&follow_ups=1'), 'the board request must carry follow_ups=1');
    assert.equal(src.split('?${periodQuery}&follow_ups=1').length - 1, 1, 'exactly one board request carries the pipelines');
  });

  it('no per-region prefetch fan-out remains', () => {
    const src = read(DASHBOARD);
    assert.ok(!/activeRegionKeys/.test(src), 'the region prefetch key list must be gone');
    assert.ok(!/Promise\.all\(\s*keys\.map/.test(src), 'the parallel per-region fetch must be gone');
    // The ONE surviving region fetch is the post-save reconcile of a single region.
    const regionCalls = (src.match(/\?region=\$\{encodeURIComponent\(regionQuery\(key\)\)\}/g) ?? []).length;
    assert.equal(regionCalls, 1, 'exactly one surgical drill fetch may remain (refreshOneAgent)');
  });

  it('a failed refetch no longer blanks the loaded board', () => {
    const src = read(DASHBOARD);
    assert.match(src, /deps: \[periodQuery\], clearOnError: false/, 'the board must keep its last good numbers on error');
  });

  it('the region cards do not remount on every period change', () => {
    assert.ok(!/key=\{`\$\{r\.id\}-\$\{period\}`\}/.test(read(DASHBOARD)), 'a keyed-by-period row remounts the whole podium');
  });
});

describe('sales board — indexes exist for the read paths', () => {
  it('the migration covers estimate/enquiry/comment/telecaller reads', () => {
    assert.ok(existsSync(MIGRATION), 'migration 0159_sales_board_indexes.sql missing');
    const sql = readFileSync(MIGRATION, 'utf8');
    for (const idx of [
      'idx_estimate_status_region',
      'idx_estimate_region_status_total',
      'idx_estimate_last_sync',
      'idx_estimate_status_accepted_at',
      'idx_enquiry_created_at',
      'idx_enquiry_agent_created',
      'idx_comment_estimate_date',
      'idx_telecaller_region',
    ]) {
      assert.match(sql, new RegExp(`CREATE INDEX IF NOT EXISTS ${idx}\\b`), `${idx} missing`);
    }
  });
});
