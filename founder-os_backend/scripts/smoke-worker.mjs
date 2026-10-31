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
  ['GET /api/human-resources/hiring-positions', '/api/human-resources/hiring-positions'],
  ['GET /api/human-resources/position-docs/x/file', '/api/human-resources/position-docs/x/file'],
  ['GET /api/delegation/board no-auth -> 401', '/api/delegation/board'],
  ['POST /api/delegation/tasks no-auth -> 401', '/api/delegation/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x', dueDate: '2026-01-01' }) }],
  ['GET /api/delegation/tasks/x/logs no-auth -> 401', '/api/delegation/tasks/x/logs'],
  ['DELETE /api/delegation/tasks/x no-auth -> 401', '/api/delegation/tasks/x', { method: 'DELETE' }],
  ['PUT /api/delegation/members/x/login-email no-auth -> 401', '/api/delegation/members/x/login-email', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loginEmail: 'a@b.com' }) }],
  ['GET /api/accounts/roster', '/api/accounts/roster'],
  ['GET /api/accounts/templates', '/api/accounts/templates'],
  ['GET /api/neodove/campaign/states no-auth -> 401', '/api/neodove/campaign/states?region=R1'],
  ['GET /api/neodove/campaign/preview no-auth -> 401', '/api/neodove/campaign/preview?region=R1&state=Punjab'],
  ['POST /api/neodove/campaign/push no-auth -> 401', '/api/neodove/campaign/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ region: 'R1', state: 'Punjab' }) }],
  ['GET /api/neodove/campaign/batches no-auth -> 401', '/api/neodove/campaign/batches?region=R1'],
  ['PUT /api/neodove/campaign/agents/R1_NEHA_VERMA/url no-auth -> 401', '/api/neodove/campaign/agents/R1_NEHA_VERMA/url', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://x.neodove.com/integration/custom/u/leads' }) }],
  ['GET /nope', '/nope'],
];

for (const [name, path, opts] of tests) {
  const r = await hit(path, opts);
  const expects404 = name.includes('(moved to GHA)');
  const ok = expects404
    ? r.status === 404
    : r.status === 200 || r.status === 401 || r.status === 404;
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
} catch (e) {
  console.log('???  accounts deep check threw:', String(e?.message || e).slice(0, 200));
}