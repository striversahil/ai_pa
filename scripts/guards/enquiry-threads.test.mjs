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

  it('attachments: locker URLs only, attachment-only messages allowed', () => {
    const ok = { url: '/api/enquiries/files/enq/abc-123.jpg', name: 'nameplate.jpg', type: 'image' };
    const kept = mod.cleanAttachments([ok, { url: 'data:image/png;base64,AAAA', name: 'x' }, { url: 'https://evil.example/x.pdf', name: 'y' }, { url: '/api/enquiries/files/enq/../../x', name: 'z' }]);
    assert.deepEqual(kept, [ok]);
    assert.equal(mod.cleanAttachments(Array.from({ length: 10 }, () => ok)).length, 6);
    let t = mk('sales', 'management').value;
    const r = replyThread(t, { desk: 'management', name: 'm' }, '', NOW, [ok]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.value.messages.at(-1).attachments, [ok]);
    assert.equal(replyThread(t, { desk: 'management', name: 'm' }, '  ', NOW, [{ url: 'data:x' }]).ok, false);
    const c = createThread({ enquiryId: 'e1', itemIndex: 0, itemName: 'I', actor: { desk: 'sales', name: 's' }, to: 'management', text: '', now: NOW, attachments: [ok] });
    assert.equal(c.ok, true);
  });

  it('summary counts only what the desk can see', () => {
    const rows = [mk('sales', 'management').value, mk('management', 'procurement').value];
    assert.deepEqual(summarizeForDesk(rows, 'sales'), { open: 1, resolved: 0, waitingOnYou: 0 });
    assert.deepEqual(summarizeForDesk(rows, 'management'), { open: 2, resolved: 0, waitingOnYou: 1 });
  });
});

describe('enquiry threads — ask-procurement transfer', () => {
  const transfer = mod.transferTranscript;
  const files = [{ url: '/api/enquiries/files/enq/a.jpg', name: 'a.jpg', type: 'image' }];
  /** A real sales query: ask -> management reply -> sales follow-up with a photo. */
  const srcThread = () => {
    const t = mk('sales', 'management', 'what is the motor rating?').value;
    const answered = replyThread(t, { desk: 'management', name: 'Mgr' }, 'checking with the vendor', NOW).value;
    return replyThread(answered, { desk: 'sales', name: 'Rep' }, '', NOW, files).value;
  };
  const mgmt = { desk: 'management', name: 'M' };

  it('transfers the COMPLETE sales query — every message, author and attachment', () => {
    const src = srcThread();
    const r = transfer({ src, actor: mgmt, note: '', now: NOW });
    assert.equal(r.ok, true);
    assert.equal(r.value.thread.channel, 'internal');
    assert.equal(r.value.thread.parentThreadId, src.id);
    assert.equal(r.value.thread.waitingOn, 'procurement');
    assert.equal(r.value.copied, src.messages.length);
    const copied = r.value.thread.messages.filter((m) => m.transferred);
    assert.deepEqual(copied.map((m) => m.text), src.messages.map((m) => m.text));
    assert.deepEqual(copied.flatMap((m) => m.attachments ?? []), files);
    assert.equal(r.value.attached, 1);
    // authors survive, so procurement knows who asked what
    assert.deepEqual([...new Set(copied.map((m) => m.by))], ['sales', 'management']);
    assert.ok(r.value.thread.messages.some((m) => m.system && /transferred/i.test(m.text)));
  });

  it('privacy still holds: the transferred child is never served to sales', () => {
    const r = transfer({ src: srcThread(), actor: mgmt, note: '', now: NOW });
    assert.equal(serveForDesk(r.value.thread, 'sales'), null);
    assert.ok(serveForDesk(r.value.thread, 'procurement'));
    assert.ok(serveForDesk(r.value.thread, 'management'));
  });

  it('a transfer never annotates the sales thread (sales learns nothing)', () => {
    const src = srcThread();
    const before = JSON.stringify(src.messages);
    const r = transfer({ src, actor: mgmt, note: 'please quote this — client is waiting', now: NOW });
    assert.equal(r.ok, true);
    // The sales conversation is a pure input: no marker, no note, no mutation.
    assert.equal(JSON.stringify(src.messages), before);
    assert.ok(!/procurement|transferred|private/i.test(JSON.stringify(src)), 'sales thread must not mention the internal hand-off');
    // And the served sales payload is literally nothing for that thread.
    assert.equal(JSON.stringify(serveForDesk(r.value.thread, 'sales') ?? null), 'null');
  });

  it('re-forward copies only the delta and reopens the same child', () => {
    const src = srcThread();
    const first = transfer({ src, actor: mgmt, note: 'please quote', now: NOW });
    const child = resolveThread(first.value.thread, { desk: 'procurement', name: 'P' }, NOW).value;
    assert.equal(child.status, 'resolved');
    const later = replyThread(src, { desk: 'sales', name: 'Rep' }, 'client added: IP55', NOW).value;
    const again = transfer({ src: later, actor: mgmt, note: '', now: NOW, existing: child });
    assert.equal(again.ok, true);
    assert.equal(again.value.copied, 1);
    assert.equal(again.value.reopened, true);
    assert.equal(again.value.thread.status, 'open');
    assert.equal(again.value.thread.waitingOn, 'procurement');
    assert.equal(again.value.thread.id, child.id);
    assert.ok(again.value.thread.messages.filter((m) => m.transferred).some((m) => m.text === 'client added: IP55'));
    // no duplicate copies of the messages already transferred
    assert.equal(again.value.thread.messages.filter((m) => m.transferred).length, src.messages.length + 1);
  });

  it('refuses an empty re-forward instead of spamming the thread', () => {
    const src = srcThread();
    const first = transfer({ src, actor: mgmt, note: '', now: NOW });
    const again = transfer({ src, actor: mgmt, note: '  ', now: NOW, existing: first.value.thread });
    assert.equal(again.ok, false);
    assert.equal(again.status, 400);
  });

  it('over-cap transcripts say how many messages were omitted', () => {
    const many = mk('sales', 'management', 'm0').value;
    many.messages = Array.from({ length: 205 }, (_, i) => ({ id: `tm_cap_${i}`, by: 'sales', authorName: 's', text: `m${i}`, at: NOW }));
    const r = transfer({ src: many, actor: mgmt, note: '', now: NOW });
    assert.equal(r.ok, true);
    assert.ok(r.value.thread.messages.length <= 200, 'thread stays under the message cap');
    assert.match(r.value.thread.messages[0].text, /\d+ earlier messages? omitted/);
  });

  it('management-only, sales-thread-only', () => {
    const src = srcThread();
    assert.equal(transfer({ src, actor: { desk: 'procurement', name: 'P' }, note: '', now: NOW }).ok, false);
    assert.equal(transfer({ src, actor: { desk: 'sales', name: 'S' }, note: '', now: NOW }).ok, false);
    assert.equal(transfer({ src: mk('management', 'procurement').value, actor: mgmt, note: '', now: NOW }).ok, false);
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

  it('pending-from-sales bucket is any flagged draft row (lenses, not a partition)', () => {
    const src = readFileSync(join(FRONTEND_SRC, 'components', 'ManagementReview.tsx'), 'utf8');
    assert.ok(src.includes('threadWaitingIds'), 'sales bucket must union thread queries (threads set no loop flags)');
    assert.ok(/waitingOn === "management"/.test(src), 'bucket must pick threads waiting on management');
    assert.ok(/hasOpenFlag\(e\) \|\| threadWaitingIds/.test(src), 'sales bucket: open flag on any item OR waiting thread');
    const salesFilters = [...src.matchAll(/queueUnprocessed\.filter\(\(e\) => ([^)]+)\)/g)].map((m) => m[1]);
    assert.ok(salesFilters.some((f) => f.includes('hasOpenFlag') && !f.includes('isManagementPendingEnquiry')),
      'sales bucket must not exclude Active rows (mixed rows double-list by design)');
  });

  it('the Transferred marker can never render on the sales desk', () => {
    const fe = readFileSync(join(FRONTEND_SRC, 'components', 'enquiry-threads', 'ThreadCard.tsx'), 'utf8');
    const line = (fe.match(/[^\n]*m\.transferred[^\n]*/) ?? [''])[0];
    assert.ok(line, 'marker must exist so its gate stays reviewable');
    assert.ok(/internal/.test(line), 'marker gated to the internal channel');
    assert.ok(/sales/.test(line), 'marker explicitly blocked on the sales desk');
  });

  it('thread writes paint optimistic echoes before the server confirms', () => {
    const src = readFileSync(join(FRONTEND_SRC, 'enquiry-threads', 'useThreads.ts'), 'utf8');
    assert.ok(src.includes('tmp-'), 'echoes need temp ids stripped on confirm');
    assert.ok(src.includes('patch(optimistic)'), 'echo must paint before the request runs');
  });
});
