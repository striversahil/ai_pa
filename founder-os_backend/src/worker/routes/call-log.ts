// ─────────────────────────────────────────────────────────────────────────────
// routes/call-log.ts — manager/agent call-log review, device provisioning and
// recording playback. Agents are hard-locked to their own roster row; managers
// (MIS / sales-head / root) see every region.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { notifyLive, LiveEvent, type Bindings } from '../context';
import { callViewer, requireCallManager } from '../../modules/device-calls/scopes';
import {
  createPairCode,
  expireRecordings,
  getCall,
  getDevice,
  listCalls,
  listDevices,
  revokeDevice,
  setLoggingOnly,
  summary,
} from '../../modules/device-calls/store';
import { readBody } from '../http';

function filters(c: any, telecallerId: string | null) {
  return {
    telecallerId,
    agentId: c.req.query('agentId') ?? null,
    from: c.req.query('from') ?? null,
    to: c.req.query('to') ?? null,
    direction: c.req.query('direction') ?? null,
    status: c.req.query('status') ?? null,
    q: c.req.query('q') ?? null,
    before: c.req.query('before') ?? null,
    limit: Number(c.req.query('limit') ?? 100) || 100,
  };
}

export function registerCallLogRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/call-log/calls', async (c) => {
    const viewer = await callViewer(c);
    if (!viewer) return c.json({ error: 'authentication required' }, 401);
    const rows = await listCalls(c.env.DB, filters(c, viewer.isManager ? null : viewer.telecallerId));
    return c.json({ calls: rows, viewer: { isManager: viewer.isManager } });
  });

  app.get('/api/call-log/summary', async (c) => {
    const viewer = await callViewer(c);
    if (!viewer) return c.json({ error: 'authentication required' }, 401);
    const totals = await summary(c.env.DB, filters(c, viewer.isManager ? null : viewer.telecallerId));
    return c.json({ totals });
  });

  // ── Recording playback (Range-capable, never exposes the R2 key) ──────────
  app.get('/api/call-log/recording/:callId', async (c) => {
    const viewer = await callViewer(c);
    if (!viewer) return c.json({ error: 'authentication required' }, 401);
    if (!c.env.CALL_RECORDINGS) return c.json({ error: 'recording storage is not configured' }, 501);
    const call: any = await getCall(c.env.DB, c.req.param('callId'));
    if (!call?.recordingKey) return c.json({ error: 'no recording' }, 404);
    if (!viewer.isManager && String(call.telecallerId) !== viewer.telecallerId) return c.json({ error: 'not your call' }, 403);
    const obj = await c.env.CALL_RECORDINGS.get(String(call.recordingKey), { range: c.req.raw.headers });
    if (!obj) return c.json({ error: 'recording expired or missing' }, 404);
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'private, max-age=3600');
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'audio/mp4');
    const range = c.req.header('range');
    const outHeaders = Object.fromEntries(headers.entries());
    if (range && obj.range) {
      const r: any = obj.range;
      headers.set('Content-Range', `bytes ${r.offset}-${r.offset + (r.length ?? obj.size) - 1}/${obj.size}`);
      return c.body(obj.body, 206, outHeaders);
    }
    return c.body(obj.body, 200, outHeaders);
  });

  // ── Device provisioning (managers) ────────────────────────────────────────
  app.get('/api/call-log/devices', async (c) => {
    if (!(await requireCallManager(c))) return c.json({ error: 'sales-head, MIS or root only' }, 403);
    return c.json({ devices: await listDevices(c.env.DB) });
  });

  app.post('/api/call-log/devices/pair-code', async (c) => {
    if (!(await requireCallManager(c))) return c.json({ error: 'sales-head, MIS or root only' }, 403);
    const body = await readBody(c);
    const telecallerId = String(body?.telecallerId ?? '').trim();
    if (!telecallerId) return c.json({ error: 'telecallerId required' }, 400);
    const tc: any = await c.env.DB.prepare('SELECT id, deleted FROM Telecaller WHERE id = ? LIMIT 1').bind(telecallerId).first();
    if (!tc || tc.deleted) return c.json({ error: 'agent not found' }, 404);
    const viewer = await callViewer(c);
    const created = await createPairCode(c.env.DB, telecallerId, viewer?.name ?? '');
    return c.json({ ok: true, ...created }, 201);
  });

  app.patch('/api/call-log/devices/:id', async (c) => {
    if (!(await requireCallManager(c))) return c.json({ error: 'sales-head, MIS or root only' }, 403);
    const body = await readBody(c);
    if (typeof body?.loggingOnly !== 'boolean') return c.json({ error: 'loggingOnly boolean required' }, 400);
    const ok = await setLoggingOnly(c.env.DB, c.req.param('id'), body.loggingOnly);
    if (!ok) return c.json({ error: 'device not found' }, 404);
    notifyLive(c, { type: LiveEvent.DeviceCalls, action: 'config' });
    return c.json({ ok: true });
  });

  app.delete('/api/call-log/devices/:id', async (c) => {
    if (!(await requireCallManager(c))) return c.json({ error: 'sales-head, MIS or root only' }, 403);
    const device = await getDevice(c.env.DB, c.req.param('id'));
    if (!device) return c.json({ error: 'device not found' }, 404);
    const viewer = await callViewer(c);
    const ok = await revokeDevice(c.env.DB, c.req.param('id'), viewer?.name ?? '');
    notifyLive(c, { type: LiveEvent.DeviceCalls, action: 'revoked' });
    return c.json({ ok });
  });

  // ── Retention housekeeping (called by the daily cron) ─────────────────────
  app.post('/api/call-log/expire', async (c) => {
    if (!(await requireCallManager(c))) return c.json({ error: 'forbidden' }, 403);
    return c.json({ ok: true, expired: await expireRecordings(c.env.DB) });
  });
}
