// customer-push.test.mjs — Guard: Customer push is dialer-only (2026-11-28).
//
// Locks the restored surface (text-level, zero deps):
//   backend  → mig 0189 renames the ledger off the vendor name, keeps the
//              indexes, and copies the dead agent table aside
//   backend  → modules/customer-push exists, delivers through dialer
//              enqueueLeads, and carries NO neo-dove identifier
//   backend  → route registered, gate = requireSalesManager
//   backend  → dialer listBatches reads region/state/requester from the ledger
//   frontend → controller mounts the section; API + event filter exist;
//              mirror constants (regions, skip reasons) match the backend
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_DIR } from './_bundle.mjs';

const SRC = join(BACKEND_DIR, 'src');
const FE = join(BACKEND_DIR, '..', 'founder-os_frontend', 'src');
const read = (p) => readFileSync(p, 'utf8');

const moduleDir = join(SRC, 'modules', 'customer-push');
const route = read(join(SRC, 'worker', 'routes', 'customer-push.ts'));
const worker = read(join(SRC, 'worker.ts'));
const queue = read(join(SRC, 'modules', 'dialer', 'queue.ts'));
const pure = read(join(moduleDir, 'pure.ts'));
const selection = read(join(moduleDir, 'selection.ts'));
const service = read(join(moduleDir, 'service.ts'));
const types = read(join(moduleDir, 'types.ts'));

const feDomain = read(join(FE, 'telecalling', 'customer-push.ts'));
const panel = read(join(FE, 'components', 'SalesControllerPanel.tsx'));
const section = read(join(FE, 'components', 'telecalling', 'CustomerPushSection.tsx'));

describe('customer push ledger (0189)', () => {
  it('renames both tables and rebuilds neutral indexes', () => {
    const sql = read(join(BACKEND_DIR, 'migrations', '0189_customer_push_ledger.sql'));
    assert.ok(/ALTER TABLE NeoDovePushBatch RENAME TO CustomerPushBatch/.test(sql), 'batch rename missing');
    assert.ok(/ALTER TABLE NeoDoveLeadPush RENAME TO CustomerPushLead/.test(sql), 'lead rename missing');
    assert.ok(/idx_customer_push_lead_batch/.test(sql), 'lead index missing');
    assert.ok(/CREATE TABLE IF NOT EXISTS _backup_neodove_agent_20261128/.test(sql), 'agent backup missing');
  });
});

describe('backend module is dialer-only', () => {
  it('files exist and no neo-dove identifier survives', () => {
    for (const file of ['types.ts', 'pure.ts', 'selection.ts', 'store.ts', 'service.ts']) {
      assert.ok(existsSync(join(moduleDir, file)), `${file} missing`);
      // The lowercase legacy `target` literal is the ONE allowed mention.
      const named = read(join(moduleDir, file)).replace(/'neodove'/g, "''").replace(/retired NeoDove target/g, '').replace(/the NeoDove era/g, '');
      assert.ok(!/neodove/i.test(named), `${file} still names NeoDove`);
    }
    assert.ok(!/neodove/i.test(route), 'route still names NeoDove');
  });

  it('delivers through the dialer queue, never a browser chunk runner', () => {
    assert.ok(/from '..\/dialer\/queue'/.test(service), 'service must import the dialer queue');
    assert.ok(/enqueueLeads\(/.test(service), 'service must enqueue leads');
    assert.ok(!/claimPending|deliverToNeoDove|campaignUrl/.test(service), 'chunk runner must stay retired');
  });

  it('exactly one destination is written', () => {
    assert.ok(/target: 'dialer'/.test(service), 'new pushes must record the dialer target');
    assert.ok(!/PUSH_TARGETS/.test(service + pure + selection + types), 'no target selector');
  });

  it('selection dedupes by mobile and splits by a stable hash', () => {
    assert.ok(/seenMobile/.test(selection), 'mobile dedupe missing');
    assert.ok(/function hash32/.test(selection), 'stable split hash missing');
    assert.ok(/agentIndexFor/.test(selection), 'agent bucket missing');
  });
});

describe('route wiring', () => {
  it('is registered and gated for sales-head/root', () => {
    assert.ok(/registerCustomerPushRoutes\(app\)/.test(worker), 'route not registered');
    const gates = route.match(/requireSalesManager\(c\)/g) ?? [];
    assert.ok(gates.length >= 5, `expected 5 gated endpoints, saw ${gates.length}`);
    for (const path of ['states', 'districts', 'preview', 'push', 'batches']) {
      assert.ok(route.includes(`/api/customer-push/${path}`), `${path} endpoint missing`);
    }
    assert.ok(/LiveEvent.DeviceCalls/.test(route), 'push must broadcast device-calls');
  });

  it('dialer history reads region/state/requester from the push ledger', () => {
    assert.ok(/LEFT JOIN CustomerPushBatch b ON b.id = q.batchId/.test(queue), 'ledger join missing');
    assert.ok(/b\.region, b\.state, b\.requestedByName/.test(queue), 'labels not selected');
  });
});

describe('frontend mirror', () => {
  it('the Controller mounts the section after the Auto Dialer', () => {
    assert.ok(/import CustomerPushSection/.test(panel), 'import missing');
    const dialer = panel.indexOf('<AutoDialerSection');
    const push = panel.indexOf('<CustomerPushSection');
    assert.ok(push > dialer && dialer > -1, 'Customer push must mount after Auto Dialer');
    assert.ok(/customerPushApi\.push/.test(section), 'section must push through the API module');
    assert.ok(!/fetch\(/.test(section), 'components never fetch directly');
  });

  it('live filter + endpoints match the backend', () => {
    assert.ok(/CUSTOMER_PUSH_EVENTS = \["device-calls"\]/.test(feDomain), 'live filter must be device-calls');
    for (const path of ['states', 'districts', 'preview', 'push', 'batches']) {
      assert.ok(feDomain.includes(`/api/customer-push/${path}`), `FE ${path} endpoint missing`);
    }
  });

  it('shared constants agree (regions, skip reasons)', () => {
    for (const region of ['R1', 'R2', 'R3', 'R4']) {
      assert.ok(pure.includes(`'${region}'`), `backend missing ${region}`);
      assert.ok(feDomain.includes(`"${region}"`), `frontend missing ${region}`);
    }
    for (const reason of ['no_phone', 'invalid_phone', 'duplicate_mobile_in_batch', 'already_queued']) {
      assert.ok(types.includes(reason), `backend missing skip reason ${reason}`);
      assert.ok(feDomain.includes(reason), `frontend missing skip reason ${reason}`);
    }
  });
});
