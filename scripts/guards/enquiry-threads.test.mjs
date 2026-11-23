// enquiry-threads.test.mjs — three-desk enquiry conversations.
//
// Founder rules under test:
//   2026-11-20  the internal (management<->procurement) channel is NEVER served
//               to the sales desk, by list, inbox or id.
//   2026-11-21  a PRODUCT QUERY is one shared conversation: procurement sees it
//               when it is raised (no forwarding step) and answers in place,
//               presented to Sales as MANAGEMENT (no name, no desk, no vendor
//               names). A RATE NEGOTIATION never reaches procurement.
// Also locks the FE type mirror and the retired forward endpoint.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleToFile, BACKEND_DIR, FRONTEND_SRC } from './_bundle.mjs';

const mod = await import(bundleToFile(join(BACKEND_DIR, 'src', 'modules', 'enquiry-threads', 'pure.ts')));
const {
  channelBetween, serveForDesk, canSee, createThread, replyThread, resolveThread, reopenThread,
  deskAllowed, summarizeForDesk, waitingOnAllFor, scrubVendors, stampSalesCopy,
} = mod;

const me = (scopes, extra = {}) => ({ user: { id: 'u', email: 'x@y', name: 'X' }, scopes, roles: [], isRoot: false, isAdmin: false, ...extra });
const NOW = '2026-11-21T10:00:00.000Z';
const mk = (from, to, text = 'hello', category) => createThread({
  enquiryId: 'e1', itemIndex: 0, itemName: 'Item', actor: { desk: from, name: from }, to, text, now: NOW, category,
});
/** Legacy-shaped sales thread (no category) — must behave exactly as before. */
const legacy = () => {
  const t = mk('sales', 'management').value;
  return { ...t, category: null };
};

describe('enquiry conversations — confidentiality (2026-11-20 rule)', () => {
  it('the internal channel is never served to the sales desk', () => {
    const internal = mk('management', 'procurement').value;
    assert.equal(internal.channel, 'internal');
    assert.equal(internal.category, null, 'internal threads carry no category');
    assert.equal(canSee(internal, 'sales'), false);
    assert.equal(serveForDesk(internal, 'sales'), null);
    assert.ok(serveForDesk(internal, 'procurement'));
    assert.ok(serveForDesk(internal, 'management'));
  });

  it('sales and procurement never talk directly', () => {
    assert.equal(channelBetween('sales', 'procurement'), null);
    assert.equal(mk('sales', 'procurement').ok, false);
    assert.equal(mk('procurement', 'sales').ok, false);
    assert.equal(channelBetween('procurement', 'management'), 'internal');
    assert.equal(channelBetween('management', 'sales'), 'sales');
  });

  it('a legacy (pre-category) sales thread stays closed to procurement — no backfill', () => {
    const t = legacy();
    assert.equal(t.category, null);
    assert.deepEqual(serveForDesk(t, 'procurement'), null);
    assert.ok(serveForDesk(t, 'sales'));
  });
});

describe('management→sales questions stay private (2026-11-23)', () => {
  it('a question Management asks Sales carries no category and never reaches procurement', () => {
    // The live case: Enquiry No 7 - 23 NOV TL, "does the client require rubber
    // or rexene bag?" — asked by management, wrongly stored as a product query.
    const t = mk('management', 'sales', 'does the client require rubber or rexene bag?', 'product_query').value;
    assert.equal(t.channel, 'sales');
    assert.equal(t.openedBy, 'management');
    assert.equal(t.category, null, 'management must never open a procurement-visible product query');
    assert.ok(serveForDesk(t, 'sales'), 'sales sees it');
    assert.ok(serveForDesk(t, 'management'), 'management sees it');
    assert.equal(serveForDesk(t, 'procurement'), null, 'procurement must not see it');
    assert.equal(canSee(t, 'procurement'), false);
    assert.equal(replyThread(t, { desk: 'procurement', name: 'P' }, 'x', NOW).ok, false);
    assert.equal(resolveThread(t, { desk: 'procurement', name: 'P' }, NOW).ok, false);
    assert.equal(reopenThread(t, { desk: 'procurement', name: 'P' }, NOW).ok, false);
  });

  it('a stale row that still carries the category is hidden by canSee', () => {
    // Migration 0162 backfills these; visibility must not depend on the
    // backfill having run (defence in depth).
    const stale = { ...mk('sales', 'management', 'q', 'product_query').value, openedBy: 'management', category: 'product_query' };
    assert.equal(canSee(stale, 'procurement'), false);
    assert.equal(canSee(stale, 'sales'), true);
    assert.equal(canSee(stale, 'management'), true);
  });

  it('sales-raised product queries still reach procurement', () => {
    const t = mk('sales', 'management', 'which motor?', 'product_query').value;
    assert.equal(canSee(t, 'procurement'), true);
    assert.ok(serveForDesk(t, 'procurement'));
  });

  it('procurement-raised threads are internal with no category', () => {
    const t = mk('procurement', 'management', 'price list', 'product_query').value;
    assert.equal(t.channel, 'internal');
    assert.equal(t.category, null);
    assert.equal(canSee(t, 'procurement'), true);
    assert.equal(canSee(t, 'management'), true);
    assert.equal(canSee(t, 'sales'), false);
  });

  it('the composer offers the category picker to SALES only', () => {
    const fe = readFileSync(join(FRONTEND_SRC, 'enquiry-threads', 'types.ts'), 'utf8');
    assert.ok(fe.includes("return desk === 'sales' && to === 'management'"), 'needsCategory must be sales-only');
    const form = readFileSync(join(FRONTEND_SRC, 'components', 'enquiry-threads', 'NewThreadForm.tsx'), 'utf8');
    assert.ok(form.includes('Private with Sales'), 'management→sales must say it is private');
  });

  it('migration 0162 clears the stale category on non-sales-opened rows', () => {
    const sql = readFileSync(join(BACKEND_DIR, 'migrations', '0162_management_threads_private.sql'), 'utf8');
    assert.ok(sql.includes('SET category = NULL'));
    assert.ok(sql.includes("openedBy <> 'sales'"));
    assert.ok(sql.includes("channel = 'sales'"));
  });
});

describe('enquiry conversations — category routing (2026-11-21)', () => {
  it('a product query is visible to all three desks without any forward step', () => {
    const t = mk('sales', 'management', 'which motor?', 'product_query').value;
    assert.equal(t.category, 'product_query');
    for (const d of ['sales', 'management', 'procurement']) assert.ok(serveForDesk(t, d), `${d} must see a product query`);
  });

  it('a rate negotiation never reaches procurement', () => {
    const t = mk('sales', 'management', 'client wants 400', 'rate_negotiation').value;
    assert.equal(t.category, 'rate_negotiation');
    assert.equal(serveForDesk(t, 'procurement'), null, 'procurement must never see rate talk');
    assert.ok(serveForDesk(t, 'sales'));
    assert.ok(serveForDesk(t, 'management'));
    // and it cannot be replied to / resolved by procurement either
    assert.equal(replyThread(t, { desk: 'procurement', name: 'P' }, 'x', NOW).ok, false);
    assert.equal(resolveThread(t, { desk: 'procurement', name: 'P' }, NOW).ok, false);
    assert.equal(reopenThread(t, { desk: 'procurement', name: 'P' }, NOW).ok, false);
  });

  it('categories default to product_query, never to the rate channel', () => {
    assert.equal(mk('sales', 'management').value.category, 'product_query');
    assert.equal(mk('sales', 'management', 'x', 'nonsense').value.category, 'product_query');
  });

  it('procurement may answer a product query in place; the turn returns to Sales', () => {
    let t = mk('sales', 'management', 'which motor?', 'product_query').value;
    assert.equal(t.waitingOn, 'management');
    const r = replyThread(t, { desk: 'procurement', name: 'Ramesh' }, 'IP55 is available', NOW);
    assert.equal(r.ok, true);
    t = r.value;
    assert.equal(t.waitingOn, 'sales', 'sales owes the next reply (it looks like management answered)');
    assert.equal(t.messages.at(-1).by, 'procurement', 'true authorship is stored');
  });

  it('either side may resolve; procurement can resolve its own product query', () => {
    const t = mk('sales', 'management', 'q', 'product_query').value;
    assert.equal(resolveThread(t, { desk: 'procurement', name: 'P' }, NOW).value.status, 'resolved');
    assert.equal(resolveThread(t, { desk: 'sales', name: 'S' }, NOW).value.status, 'resolved');
    assert.equal(resolveThread(t, { desk: 'management', name: 'M' }, NOW).value.status, 'resolved');
  });

  it('waiting sets: product queries wait on management AND procurement, sales never hears procurement', () => {
    const t = mk('sales', 'management', 'q', 'product_query').value;
    assert.deepEqual(waitingOnAllFor(t, 'management'), ['management', 'procurement']);
    assert.deepEqual(waitingOnAllFor(t, 'procurement'), ['management', 'procurement']);
    assert.deepEqual(waitingOnAllFor(t, 'sales'), ['management'], 'sales is never told procurement is involved');
    const answered = replyThread(t, { desk: 'procurement', name: 'P' }, 'ok', NOW).value;
    assert.deepEqual(waitingOnAllFor(answered, 'management'), ['sales']);
    const rate = mk('sales', 'management', 'q', 'rate_negotiation').value;
    assert.deepEqual(waitingOnAllFor(rate, 'management'), ['management']);
  });

  it('each scope acts only as its own desk; management access covers all', () => {
    assert.equal(deskAllowed(me(['enquiry-tracker']), 'sales'), true);
    assert.equal(deskAllowed(me(['enquiry-tracker']), 'procurement'), false);
    assert.equal(deskAllowed(me(['procurement']), 'procurement'), true);
    assert.equal(deskAllowed(me(['procurement']), 'sales'), false);
    const mgmt = me(['enquiry-management']);
    for (const d of ['sales', 'procurement', 'management']) assert.equal(deskAllowed(mgmt, d), true);
    assert.equal(deskAllowed(null, 'sales'), false);
  });
});

describe('enquiry conversations — procurement speaks as Management', () => {
  const vendors = ['Shree Steel Works', 'Balaji'];
  const answered = () => {
    const t = mk('sales', 'management', 'which motor?', 'product_query').value;
    const r = replyThread(t, { desk: 'procurement', name: 'Ramesh' }, 'Shree Steel Works has IP55, Balaji does not', NOW);
    const msgs = [...r.value.messages];
    msgs[msgs.length - 1] = stampSalesCopy(msgs[msgs.length - 1], vendors);
    return { ...r.value, messages: msgs };
  };

  it('sales sees the reply as Management — no name, no desk, no vendor', () => {
    const sales = serveForDesk(answered(), 'sales');
    const msg = sales.messages.at(-1);
    assert.equal(msg.by, 'management');
    assert.equal(msg.authorName, 'Management');
    assert.ok(!/procurement|ramesh|shree|balaji/i.test(JSON.stringify(sales)), 'sales payload must not leak the desk, the person or the vendor');
    assert.match(msg.text, /our supplier/);
    assert.equal(msg.masked, undefined, 'no masking marker is ever served to sales');
    assert.equal(msg.salesText, undefined, 'the raw copy is never served to sales');
  });

  it('management + procurement keep true authorship and the original text', () => {
    const t = answered();
    for (const d of ['management', 'procurement']) {
      const served = serveForDesk(t, d);
      const msg = served.messages.at(-1);
      assert.equal(msg.by, 'procurement');
      assert.equal(msg.authorName, 'Ramesh');
      assert.equal(msg.masked, true, 'the UI can explain what sales will see');
      assert.match(msg.text, /Shree Steel Works/);
    }
  });

  it('scrub replaces every vendor name, longest first, case-insensitively', () => {
    assert.equal(scrubVendors('SHREE STEEL WORKS quoted 410; shree steel works is cheaper', vendors), 'our supplier quoted 410; our supplier is cheaper');
    assert.equal(scrubVendors('no vendors here', vendors), 'no vendors here');
    assert.equal(scrubVendors('Balaji', []), 'Balaji', 'nothing to scrub without a vendor list');
  });

  it('attachment filenames are scrubbed for sales only', () => {
    const t = mk('sales', 'management', 'q', 'product_query').value;
    const withFile = {
      ...t,
      messages: [{ ...t.messages[0], by: 'procurement', authorName: 'Ramesh', text: 'see file',
        attachments: [{ url: '/api/enquiries/files/enq/a.pdf', name: 'Shree Steel Works quote.pdf', type: 'pdf' }] }],
    };
    const stamped = stampSalesCopy(withFile.messages[0], vendors);
    const thread = { ...withFile, messages: [stamped] };
    assert.equal(serveForDesk(thread, 'sales').messages[0].attachments[0].name, 'our supplier quote.pdf');
    assert.equal(serveForDesk(thread, 'management').messages[0].attachments[0].name, 'Shree Steel Works quote.pdf');
  });
});

describe('enquiry conversations — open / resolved flow', () => {
  it('reply hands the turn to the other side and reopens a resolved thread', () => {
    let t = mk('sales', 'management', 'hello', 'product_query').value;
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

  it('attachments: locker URLs only, attachment-only messages allowed', () => {
    const ok = { url: '/api/enquiries/files/enq/abc-123.jpg', name: 'nameplate.jpg', type: 'image' };
    const kept = mod.cleanAttachments([ok, { url: 'data:image/png;base64,AAAA', name: 'x' }, { url: 'https://evil.example/x.pdf', name: 'y' }, { url: '/api/enquiries/files/enq/../../x', name: 'z' }]);
    assert.deepEqual(kept, [ok]);
    assert.equal(mod.cleanAttachments(Array.from({ length: 10 }, () => ok)).length, 6);
    const t = mk('sales', 'management').value;
    assert.equal(replyThread(t, { desk: 'management', name: 'm' }, '', NOW, [ok]).ok, true);
    assert.equal(replyThread(t, { desk: 'management', name: 'm' }, '  ', NOW, [{ url: 'data:x' }]).ok, false);
  });

  it('summary counts what each desk sees, including the shared waiting set', () => {
    const rows = [
      mk('sales', 'management', 'product?', 'product_query').value,
      mk('sales', 'management', 'rate?', 'rate_negotiation').value,
      mk('management', 'procurement').value,
    ];
    assert.deepEqual(summarizeForDesk(rows, 'sales'), { open: 2, resolved: 0, waitingOnYou: 0 });
    // the product query and the internal thread both wait on procurement
    assert.deepEqual(summarizeForDesk(rows, 'procurement'), { open: 2, resolved: 0, waitingOnYou: 2 });
    assert.deepEqual(summarizeForDesk(rows, 'management'), { open: 3, resolved: 0, waitingOnYou: 2 });
  });
});

describe('enquiry conversations — wiring', () => {
  it('service gates every read and write by desk + visibility', () => {
    const src = readFileSync(join(BACKEND_DIR, 'src', 'modules', 'enquiry-threads', 'service.ts'), 'utf8');
    assert.ok(src.includes('!canSee(thread, g.value)'), 'actOnThread must hide invisible threads');
    assert.ok((src.match(/serveForDesk/g) ?? []).length >= 2, 'every read path must pass serveForDesk');
    assert.ok(src.includes('listThreadsForEnquiry(db, enquiryId, g.value)'), 'reads are desk-scoped, not channel-scoped');
    assert.ok(src.includes('stampSalesCopy'), 'procurement replies must be scrubbed for sales');
  });

  it('sales-channel SQL mirror matches canSee (legacy rows excluded for procurement)', () => {
    const src = readFileSync(join(BACKEND_DIR, 'src', 'modules', 'enquiry-threads', 'store.ts'), 'utf8');
    assert.ok(src.includes("channel = 'sales' AND ${prefix}category = 'product_query'"), 'procurement SQL must require the product category');
    assert.ok(src.includes("${prefix}openedBy = 'sales'"), 'procurement SQL must require a SALES-raised query (2026-11-23)');
    assert.ok(/desk === 'sales'\) return `\$\{prefix\}channel = 'sales'`/.test(src), 'sales SQL stays sales-channel only');
  });

  it('the forward endpoint is retired, and the sales desk has no forward button', () => {
    const route = readFileSync(join(BACKEND_DIR, 'src', 'worker', 'routes', 'enquiry-threads.ts'), 'utf8');
    assert.ok(route.includes('{ retired: true }'), 'forward must be a retired stub');
    const card = readFileSync(join(FRONTEND_SRC, 'components', 'enquiry-threads', 'ThreadCard.tsx'), 'utf8');
    assert.ok(!/onForward|Send query to Procurement/.test(card), 'no forwarding UI may remain');
    const inbox = readFileSync(join(FRONTEND_SRC, 'components', 'enquiry-threads', 'ThreadInbox.tsx'), 'utf8');
    assert.ok(!/onForward/.test(inbox), 'inbox must not offer forwarding');
  });

  it('live events carry ids only, never text', () => {
    const src = readFileSync(join(BACKEND_DIR, 'src', 'worker', 'routes', 'enquiry-threads.ts'), 'utf8');
    const m = src.match(/notifyLive\(c, \{([^}]*)\}/);
    assert.ok(m && !/text|messages/.test(m[1]), 'live payload must not include message text');
  });

  it('frontend type mirror keeps the same desks, channels and categories', () => {
    const fe = readFileSync(join(FRONTEND_SRC, 'enquiry-threads', 'types.ts'), 'utf8');
    assert.ok(fe.includes("'sales' | 'procurement' | 'management'"), 'FE ThreadDesk union drifted');
    assert.ok(fe.includes("'sales' | 'internal'"), 'FE ThreadChannel union drifted');
    assert.ok(fe.includes("'product_query' | 'rate_negotiation'"), 'FE ThreadCategory union drifted');
  });

  it('thread writes paint optimistic echoes before the server confirms', () => {
    const src = readFileSync(join(FRONTEND_SRC, 'enquiry-threads', 'useThreads.ts'), 'utf8');
    assert.ok(src.includes('tmp-'), 'echoes need temp ids stripped on confirm');
    assert.ok(src.includes('patch(optimistic)'), 'echo must paint before the request runs');
  });
});
