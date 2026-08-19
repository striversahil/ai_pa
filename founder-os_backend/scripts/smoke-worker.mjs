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