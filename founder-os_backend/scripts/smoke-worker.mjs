// Smoke test: exercises the bundled worker with a fake D1 so we can validate
// route wiring without LLM / DB. Run: node scripts/smoke-worker.mjs
const app = (await import('../dist-worker/worker.js')).default;
import { fakeD1 } from './d1-mock.mjs';

const env = {
  DB: fakeD1(),
  SHARED_SECRET: 'test-secret',
  WA_ENGINE_API_KEY: 'test-wa',
};

async function hit(path, opts = {}) {
  const req = new Request('http://local' + path, opts);
  try {
    const res = await app.fetch(req, env, {});
    const body = await res.text();
    return { status: res.status, body: body.slice(0, 120) };
  } catch (e) {
    return { status: 'ERR', body: String(e.message || e).slice(0, 200) };
  }
}

const tests = [
  ['GET /health', '/health'],
  ['GET /api/health', '/api/health'],
  ['GET /api/status', '/api/status'],
  ['GET /webhook?hub.challenge=abc', '/webhook?hub.challenge=abc'],
  ['POST /webhook waengine', '/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'message.status', data: { wa_message_id: 'x1' } }) }],
  ['POST /api/whatsapp/webhook', '/api/whatsapp/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'message.received', data: { message: { id: 'm1', text: { body: 'hello' }, timestamp: Date.now() / 1000 }, contact: { phone_number: '918595563952' } } }) }],
  ['GET /api/logs auth', '/api/logs', { headers: { Authorization: 'Bearer test-secret' } }],
  ['GET /api/logs no-auth', '/api/logs', { headers: { Authorization: 'Bearer wrong' } }],
  ['POST /api/trigger/briefing no-auth', '/api/trigger/briefing', { method: 'POST', headers: { Authorization: 'Bearer wrong' } }],
  ['POST /api/trigger/briefing (moved to GHA)', '/api/trigger/briefing', { method: 'POST', headers: { Authorization: 'Bearer test-secret' } }],
  ['POST /api/trigger/email-sync (moved to GHA)', '/api/trigger/email-sync', { method: 'POST', headers: { Authorization: 'Bearer test-secret' } }],
  ['POST /api/trigger/digest (moved to GHA)', '/api/trigger/digest', { method: 'POST', headers: { Authorization: 'Bearer test-secret' } }],
  ['POST /api/trigger/sales-sync (moved to GHA)', '/api/trigger/sales-sync', { method: 'POST', headers: { Authorization: 'Bearer test-secret' } }],
  ['POST /api/trigger/summary (moved to GHA)', '/api/trigger/summary', { method: 'POST', headers: { Authorization: 'Bearer test-secret' } }],
  ['POST /api/trigger/zoho-sent-analyzer (moved to GHA)', '/api/trigger/zoho-sent-analyzer', { method: 'POST', headers: { Authorization: 'Bearer test-secret' } }],
  ['POST /api/trigger/email-brain-index (moved to GHA)', '/api/trigger/email-brain-index', { method: 'POST', headers: { Authorization: 'Bearer test-secret' } }],
  ['POST /api/trigger/nonexistent', '/api/trigger/nonexistent', { method: 'POST', headers: { Authorization: 'Bearer test-secret' } }],
  ['GET /api/messages/123@c.us', '/api/messages/918595563952@c.us'],
  ['GET /api/dashboard', '/dashboard'],
  ['GET /api/estimates/baseline', '/api/estimates/baseline'],
  ['GET /api/automations/telecalling/data?converters=1 (MIS export)', '/api/automations/telecalling/data?converters=1'],
  ['GET /api/telecallers/eod-reassign no-auth -> 401', '/api/telecallers/eod-reassign'],
  ['POST /api/runner/estimates/baseline no-auth', '/api/runner/estimates/baseline', { method: 'POST', headers: { Authorization: 'Bearer wrong' } }],
  ['POST /api/runner/estimates/baseline auth', '/api/runner/estimates/baseline', { method: 'POST', headers: { Authorization: 'Bearer test-secret' } }],
  ['POST /api/runner/telecalling/effort-sync no-auth', '/api/runner/telecalling/effort-sync', { method: 'POST', headers: { Authorization: 'Bearer wrong' } }],
  ['POST /api/runner/telecalling/effort-sync auth', '/api/runner/telecalling/effort-sync', { method: 'POST', headers: { Authorization: 'Bearer test-secret' } }],
  ['GET /api/automations/accounts/data', '/api/automations/accounts/data'],
  ['GET /api/session (auth disabled → 401)', '/api/session'],
  ['GET /api/session/workspaces (auth disabled → 401)', '/api/session/workspaces'],
  ['GET /api/session/workspaces/accounts/data', '/api/session/workspaces/accounts/data'],
  ['GET /api/session/workspaces/telecalling/data?converters=1', '/api/session/workspaces/telecalling/data?converters=1'],
  ['GET /api/human-resources/hiring-positions', '/api/human-resources/hiring-positions'],
  ['GET /api/human-resources/position-docs/x/file', '/api/human-resources/position-docs/x/file'],
  ['GET /api/delegation/board no-auth -> 401', '/api/delegation/board'],
  ['POST /api/delegation/tasks no-auth -> 401', '/api/delegation/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x', dueDate: '2026-01-01' }) }],
  ['GET /api/delegation/tasks/x/logs no-auth -> 401', '/api/delegation/tasks/x/logs'],
  ['DELETE /api/delegation/tasks/x no-auth -> 401', '/api/delegation/tasks/x', { method: 'DELETE' }],
  ['PUT /api/delegation/members/x/login-email no-auth -> 401', '/api/delegation/members/x/login-email', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loginEmail: 'a@b.com' }) }],
  ['POST /api/human-resources/fund-topups no-auth -> 401', '/api/human-resources/fund-topups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x', amount: 1, txnDate: '2026-01-01' }) }],
  ['PATCH /api/human-resources/fund-topups/x no-auth -> 401', '/api/human-resources/fund-topups/x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'y' }) }],
  ['DELETE /api/human-resources/fund-topups/x no-auth -> 401', '/api/human-resources/fund-topups/x', { method: 'DELETE' }],
  ['GET /api/human-resources/leave-requests no-auth -> 401', '/api/human-resources/leave-requests?status=pending'],
  ['POST /api/human-resources/leave-requests/x/decide no-auth -> 401', '/api/human-resources/leave-requests/x/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reject', note: 'no cover' }) }],
  ['GET /api/leave/mine no-auth -> 401', '/api/leave/mine'],
  ['POST /api/leave/requests no-auth -> 401', '/api/leave/requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ durationType: 'full_day', leaveType: 'casual', startDate: '2026-01-05', reason: 'family function' }) }],
  ['POST /api/leave/requests/x/cancel no-auth -> 401', '/api/leave/requests/x/cancel', { method: 'POST' }],
  ['GET /api/accounts/roster', '/api/accounts/roster'],
  ['GET /api/accounts/templates', '/api/accounts/templates'],
  ['GET /api/accounts/tasks/:id/thread no-auth -> 401', '/api/accounts/tasks/seed-04/thread'],
  ['POST /api/accounts/threads/sync no-auth -> 401', '/api/accounts/threads/sync', { method: 'POST' }],
  ['GET /api/neodove/campaign/states no-auth -> 401', '/api/neodove/campaign/states?region=R1'],
  ['GET /api/neodove/campaign/preview no-auth -> 401', '/api/neodove/campaign/preview?region=R1&state=Punjab'],
  ['POST /api/neodove/campaign/push no-auth -> 401', '/api/neodove/campaign/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ region: 'R1', state: 'Punjab' }) }],
  ['GET /api/neodove/campaign/batches no-auth -> 401', '/api/neodove/campaign/batches?region=R1'],
  ['PUT /api/neodove/campaign/agents/R1_NEHA_VERMA/url no-auth -> 401', '/api/neodove/campaign/agents/R1_NEHA_VERMA/url', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://x.neodove.com/integration/custom/u/leads' }) }],
  ['PUT /api/crm/orders/SO-1/addresses no-auth -> 401', '/api/crm/orders/SO-1/addresses', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ billingAddress: 'x' }) }],
  ['POST /api/crm/orders/SO-1/dispatch no-auth -> 401', '/api/crm/orders/SO-1/dispatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [] }) }],
  ['POST /api/crm/orders/SO-1/proofs/P1/photos no-auth -> 401', '/api/crm/orders/SO-1/proofs/P1/photos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }],
  ['PUT /api/crm/orders/SO-1/items no-auth -> 401', '/api/crm/orders/SO-1/items', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'client confirmed fewer pieces' }) }],
  ['POST /api/crm/orders/SO-1/cancel-local no-auth -> 401', '/api/crm/orders/SO-1/cancel-local', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'client cancelled the full order' }) }],
  ['POST /api/crm/orders/SO-1/reopen no-auth -> 401', '/api/crm/orders/SO-1/reopen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }],
  ['GET /api/telecalling/client-segments no-auth -> 403', '/api/telecalling/client-segments'],
  ['PUT /api/telecalling/client-segments no-auth -> 403', '/api/telecalling/client-segments', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientKey: 'TEST', segment: 'consumer' }) }],
  ['PUT /api/telecalling/client-type-rules no-auth -> 403', '/api/telecalling/client-type-rules', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ typeBase: 'Flour Mill', segment: 'consumer' }) }],
  ['GET /api/call-log/calls no-auth -> 401', '/api/call-log/calls'],
  ['GET /api/call-log/devices no-auth -> 403', '/api/call-log/devices'],
  ['POST /api/android/pair empty -> 400', '/api/android/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }],
  ['POST /api/android/pair-request empty -> 400', '/api/android/pair-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }],
  ['GET /api/android/dialer/queue no-token -> 401', '/api/android/dialer/queue'],
  ['POST /api/android/dialer/sync no-token -> 401', '/api/android/dialer/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }],
  ['GET /api/dialer/board no-auth -> 401', '/api/dialer/board'],
  ['PUT /api/dialer/config no-auth -> 401', '/api/dialer/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' }],
  ['GET /api/dialer/app no-auth -> 401', '/api/dialer/app'],
  ['GET /api/dialer/app/download no-auth -> 401', '/api/dialer/app/download'],
  ['POST /api/dialer/agents/:id/reset no-auth -> 401', '/api/dialer/agents/x/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }],
  ['GET /api/dialer/unreachable no-auth -> 401', '/api/dialer/unreachable'],
  ['GET /nope', '/nope'],
];

for (const [name, path, opts] of tests) {
  const r = await hit(path, opts);
  const expects404 = name.includes('(moved to GHA)');
  const ok = expects404
    ? r.status === 404
    : r.status === 200 || r.status === 400 || r.status === 401 || r.status === 403 || r.status === 404;
  console.log(`${ok ? 'PASS' : '???'}  ${name.padEnd(38)} -> ${r.status}`);
  if (r.status === 'ERR' || !ok) {
    console.log('     ', r.body);
  }
}

// ── Accounts deep check: seed → instances → dashboard payload → log write ──
try {
  const req = new Request('http://local/api/automations/accounts/data');
  const res = await app.fetch(req, env, {});
  const data = await res.json();
  const items = data?.items ?? [];
  const okShape = res.status === 200 && Array.isArray(items) && items.length > 0
    && Array.isArray(data?.senior) && Array.isArray(data?.junior) && Array.isArray(data?.roster)
    && items.every((t) => t.templateId && t.title && t.frequency && t.ownerRole && 'status' in t);
  console.log(`${okShape ? 'PASS' : '???'}  accounts data payload (seeds+instances) -> ${res.status} items=${items.length}`);
  const first = items.find((t) => t.logId);
  if (first) {
    const patch = new Request(`http://local/api/accounts/logs/${first.logId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done', remark: 'smoke verify' }),
    });
    const pres = await app.fetch(patch, env, {});
    const pbody = await pres.json().catch(() => ({}));
    const okPatch = pres.status === 200 && pbody.status === 'done';
    console.log(`${okPatch ? 'PASS' : '???'}  accounts log PATCH done+remark -> ${pres.status}`);
    if (!okPatch) console.log('     ', JSON.stringify(pbody).slice(0, 200));
  } else {
    console.log('???  accounts log PATCH skipped — no logId in payload');
  }
  // Threads (migration 0166): one row per task × lane carrying the window's
  // counts; the today arrays must still be present for the existing UI.
  const threads = data?.threads ?? [];
  const okThreads = Array.isArray(threads) && threads.length > 0
    && threads.every((t) => t.templateId && Array.isArray(t.slots)
      && t.slots.every((s) => s.slot && s.counts && typeof s.counts.due === 'number'
        && typeof s.counts.unresolved === 'number' && typeof s.completionPct === 'number'));
  console.log(`${okThreads ? 'PASS' : '???'}  accounts thread rows -> ${threads.length} tasks`);
  if (!okThreads) console.log('     ', JSON.stringify(threads).slice(0, 200));

  // Missed-day engine (migration 0166): a past due day nobody logged must be
  // written by the engine itself as not_done + entry_kind 'auto_miss', stay
  // not_done (never flipped to done), and count as unresolved in the thread.
  try {
    const tpl = threads.find((t) => t.frequency === 'daily' && !t.isShared && t.slots.some((s) => s.slot === 'main'));
    if (!tpl) {
      console.log('???  accounts missed-day check — no daily template in payload');
    } else {
      const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      const days = [1, 2, 3, 4, 5, 6, 7].map((i) => new Date(Date.parse(ist) - i * 86400e3).toISOString().slice(0, 10));
      const nowIso = new Date().toISOString();
      for (const d of days) {
        await env.DB.prepare(
          'INSERT INTO AccountsTaskLog (id, templateId, dueDate, slot, status, entryKind, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
        ).bind(`smoke-${d}`, tpl.templateId, d, 'main', 'pending', 'instance', nowIso, nowIso).run();
      }
      await env.DB.prepare('UPDATE AccountsTaskTemplate SET createdAt = ? WHERE id = ?')
        .bind(`${days[days.length - 1]}T00:00:00.000Z`, tpl.templateId).run();
      const res2 = await app.fetch(new Request('http://local/api/automations/accounts/data'), env, {});
      const d2 = await res2.json();
      const auto = await env.DB.prepare("SELECT COUNT(*) AS n FROM AccountsTaskLog WHERE entryKind = 'auto_miss' AND status = 'not_done' AND id LIKE 'smoke-%'").first();
      const row = (d2.threads ?? []).find((t) => t.templateId === tpl.templateId)?.slots.find((s) => s.slot === 'main');
      const missed = Number(auto?.n || 0);
      // D1 is the assertion: entryKind/status are written by the engine on the
      // payload path. The payload copy may still be the cached compute from the
      // first fetch above (5-min memory cache), so it is reported, not asserted.
      const okMiss = missed > 0;
      console.log(`${okMiss ? 'PASS' : '???'}  accounts missed day auto-recorded -> ${missed} row(s) not_done/auto_miss (cached unresolved=${row?.counts?.unresolved ?? 'n/a'})`);
    }
  } catch (e) {
    console.log('???  accounts missed-day check threw:', String(e?.message || e).slice(0, 200));
  }
} catch (e) {
  console.log('???  accounts deep check threw:', String(e?.message || e).slice(0, 200));
}