// enquiry-threads.test.mjs — three-desk enquiry threads (founder ask 2026-11-20).
//
// Locks the confidentiality rule: anything between procurement and
// management (channel 'internal') is NEVER served to the sales desk, by list,
// inbox or id; sales and procurement never talk directly; each scope may only
// act as its own desk. Also locks the FE type mirror.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleToFile, BACKEND_DIR, FRONTEND_SRC } from './_bundle.mjs';

const mod = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiry-threads', 'pure.ts')));
const { channelBetween, channelsFor, serveForDesk, createThread, replyThread, resolveThread, reopenThread, deskAllowed, summarizeForDesk } = mod;

const me = (scopes, extra = {}) => ({ user: { id: 'u', email: 'x@y', name: 'X' }, scopes, roles: [], isRoot: false, isAdmin: false, ...extra });
const NOW = '2026-11-20T10:00:00.000Z';
const mk = (from, to, text = 'hello') => createThread({ enquiryId: 'e1', itemIndex: 0, itemName: 'Item', actor: { desk: from, name: from }, to, text, now: NOW });

describe('enquiry threads — confidentiality', () => {
  it('sales desk never sees the internal channel', () => {
    assert.deepEqual(channelsFor('sales'), ['sales']);
    const internal = mk('management', 'procurement').value;
    assert.equal(internal.channel, 'internal');
    assert.equal(serveForDesk(internal, 'sales'), null);
    assert.ok(serveForDesk(internal, 'procurement'));
    assert.ok(serveForDesk(internal, 'management'));
  });

  it('procurement desk never sees the sales channel', () => {
    assert.deepEqual(channelsFor('procurement'), ['internal']);
    assert.equal(serveForDesk(mk('sales', 'management').value, 'procurement'), null);
  });

  it('sales and procurement never talk directly', () => {
    assert.equal(channelBetween('sales', 'procurement'), null);
    assert.equal(mk('sales', 'procurement').ok, false);
    assert.equal(mk('procurement', 'sales').ok, false);
    assert.equal(channelBetween('procurement', 'management'), 'internal');
    assert.equal(channelBetween('management', 'sales'), 'sales');
  });

  it('only the two parties of a channel can reply / resolve / reopen', () => {
    const internal = mk('procurement', 'management').value;
    assert.equal(replyThread(internal, { desk: 'sales', name: 's' }, 'peek', NOW).ok, false);
    assert.equal(resolveThread(internal, { desk: 'sales', name: 's' }, NOW).ok, false);
    assert.equal(reopenThread(internal, { desk: 'sales', name: 's' }, NOW).ok, false);
  });

  it('forwarded parent link is stripped for non-management desks', () => {
    const fwd = createThread({ enquiryId: 'e1', itemIndex: 0, itemName: 'I', actor: { desk: 'management', name: 'm' }, to: 'procurement', text: 'pls quote', now: NOW, parentThreadId: 'th_sales' }).value;
    assert.equal(serveForDesk(fwd, 'management').parentThreadId, 'th_sales');
    assert.equal(serveForDesk(fwd, 'procurement').parentThreadId, null);
  });

  it('each scope acts only as its own desk; management access covers all', () => {
    const sales = me(['enquiry-tracker']);
    assert.equal(deskAllowed(sales, 'sales'), true);
    assert.equal(deskAllowed(sales, 'procurement'), false);
    assert.equal(deskAllowed(sales, 'management'), false);
    const proc = me(['procurement']);
    assert.equal(deskAllowed(proc, 'procurement'), true);
    assert.equal(deskAllowed(proc, 'sales'), false);
    assert.equal(deskAllowed(proc, 'management'), false);
    const mgmt = me(['enquiry-management']);
    for (const d of ['sales', 'procurement', 'management']) assert.equal(deskAllowed(mgmt, d), true);
    assert.equal(deskAllowed(null, 'sales'), false);
  });
});

describe('enquiry threads — open / resolved flow', () => {
  it('reply hands the turn to the other side and reopens a resolved thread', () => {
    let t = mk('sales', 'management').value;
    assert.equal(t.waitingOn, 'management');
    t = replyThread(t, { desk: 'management', name: 'm' }, 'best is 410', NOW).value;
    assert.equal(t.waitingOn, 'sales');
    t = resolveThread(t, { desk: 'sales', name: 's' }, NOW).value;
    assert.equal(t.status, 'resolved');
    assert.equal(t.resolvedBy, 'sales');
    t = replyThread(t, { desk: 'sales', name: 's' }, 'client came back', NOW).value;
    assert.equal(t.status, 'open');
    assert.equal(t.waitingOn, 'management');
  });

  it('either side may resolve (founder choice 2026-11-20)', () => {
    assert.equal(resolveThread(mk('sales', 'management').value, { desk: 'management', name: 'm' }, NOW).value.status, 'resolved');
    assert.equal(resolveThread(mk('sales', 'management').value, { desk: 'sales', name: 's' }, NOW).value.status, 'resolved');
  });

  it('summary counts only what the desk can see', () => {
    const rows = [mk('sales', 'management').value, mk('management', 'procurement').value];
    assert.deepEqual(summarizeForDesk(rows, 'sales'), { open: 1, resolved: 0, waitingOnYou: 0 });
    assert.deepEqual(summarizeForDesk(rows, 'management'), { open: 2, resolved: 0, waitingOnYou: 1 });
  });
});

describe('enquiry threads — wiring', () => {
  it('service gates every read and write by desk + channel', () => {
    const src = readFileSync(join(BACKEND_DIR, 'src', 'modules', 'enquiry-threads', 'service.ts'), 'utf8');
    assert.ok(src.includes('!canSee(thread, g.value)'), 'actOnThread must hide invisible threads');
    assert.ok((src.match(/serveAll\(await/g) ?? []).length >= 2, 'both list reads (enquiry + inbox) must pass serveForDesk');
    assert.ok(src.includes('countOpenByEnquiry(db, channelsFor(g.value))'), 'counts must be channel-filtered for the desk');
    assert.ok(!/saveThreadState\(db, src\)/.test(src), 'forward must never write to the sales thread');
  });

  it('live events carry ids only, never text', () => {
    const src = readFileSync(join(BACKEND_DIR, 'src', 'worker', 'routes', 'enquiry-threads.ts'), 'utf8');
    const m = src.match(/notifyLive\(c, \{([^}]*)\}/);
    assert.ok(m && !/text|messages/.test(m[1]), 'live payload must not include message text');
  });

  it('frontend type mirror keeps the same desks + channels', () => {
    const fe = readFileSync(join(FRONTEND_SRC, 'enquiry-threads', 'types.ts'), 'utf8');
    assert.ok(fe.includes("'sales' | 'procurement' | 'management'"), 'FE ThreadDesk union drifted');
    assert.ok(fe.includes("'sales' | 'internal'"), 'FE ThreadChannel union drifted');
  });
});
