// ─────────────────────────────────────────────────────────────────────────────
// routes/dialer.ts — Founder OS auto dialer.
//
// Phone side (/api/android/*, AUTH_EXEMPT, device token via requireDevice):
//   POST /api/android/pair-request          phone asks to pair → 6-digit code
//   POST /api/android/pair-status           phone polls; gets its token once
//   POST /api/android/pair-restore          reinstall on the same phone → fresh token (active registration only)
//   GET  /api/android/dialer/config         dispositions, breaks, timers, shift (scheduled breaks for this agent only)
//   GET  /api/android/dialer/queue          due leads for this agent
//   POST /api/android/dialer/sync           calls + dispositions + breaks + state
// Controller side (/api/dialer/*, sales head / root):
//   GET  /api/dialer/pair-requests  ·  POST /api/dialer/pair-requests/:id/approve|reject
//   GET|PUT /api/dialer/config  ·  GET /api/dialer/board  ·  GET /api/dialer/report?day=
//   GET /api/dialer/batches?days=  ·  POST /api/dialer/batches/:id/remove (whole push batch off every agent's queue)
//   POST /api/dialer/queue/recall  ·  GET /api/dialer/unreachable?days=  ·  POST /api/dialer/agents/:id/reset {wipeToday?}  ·  GET /api/dialer/app (latest APK version) · GET /api/dialer/app/download
// Handlers stay thin: logic in modules/dialer/*.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { notifyLive, LiveEvent, type Bindings } from '../context';
import { requireDevice, requireCallManager, callViewer } from '../../modules/device-calls/scopes';
import { istDay } from '../../modules/device-calls/types';
import { cacheGet, cacheSet } from '../../shared/cache';
import { invalidateDeviceCallCaches } from '../../automations/telecalling/device-calls';
import { createPairRequest, listPendingRequests, approveRequest, rejectRequest, claimRequest, restoreByDevice } from '../../modules/dialer/pairing';
import { getConfig, saveConfig, listDue, recallQueue, listUnreachable, listBatches, removeBatch } from '../../modules/dialer/queue';
import { scheduledFor } from '../../modules/dialer/pure';
import { applySync } from '../../modules/dialer/sync';
import { dayReport, liveBoard } from '../../modules/dialer/report';
import { latestAppRelease, streamLatestApk } from '../../modules/dialer/app-release';
import { resetAgent } from '../../modules/dialer/reset';
import { readBody, writeError } from '../http';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

async function ipLimited(c: any, bucket: string, max: number): Promise<boolean> {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const key = `dialer:${bucket}:${ip}`;
  const hits = Number((await cacheGet<number>(key, 60_000).catch(() => 0)) ?? 0);
  if (hits >= max) return true;
  await cacheSet(key, hits + 1, 60_000).catch(() => null);
  return false;
}

/** Sales head / root, with the display name for audit columns. */
async function manager(c: any): Promise<string | null> {
  if (!(await requireCallManager(c))) return null;
  return (await callViewer(c).catch(() => null))?.name ?? 'manager';
}

function registerPhoneRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.post('/api/android/pair-request', async (c) => {
    if (await ipLimited(c, 'pairreq', 10)) return c.json({ error: 'Too many attempts — retry in a minute' }, 429);
    const body = await readBody(c);
    const deviceId = String(body?.deviceId ?? '').trim().slice(0, 64);
    if (deviceId.length < 8) return c.json({ error: 'deviceId required' }, 400);
    const created = await createPairRequest(c.env.DB, {
      deviceId,
      label: String(body?.label ?? '').trim().slice(0, 120),
      agentHint: String(body?.agentName ?? '').trim().slice(0, 80),
      appVersion: String(body?.appVersion ?? '').trim().slice(0, 40),
    });
    notifyLive(c, { type: LiveEvent.DeviceCalls, action: 'pair-request' });
    return c.json(created, 201);
  });

  app.post('/api/android/pair-status', async (c) => {
    if (await ipLimited(c, 'pairpoll', 60)) return c.json({ error: 'slow down' }, 429);
    const body = await readBody(c);
    try {
      return c.json(await claimRequest(c.env.DB, String(body?.requestId ?? ''), String(body?.secret ?? '')));
    } catch (e) {
      return writeError(c, e, 'pair status failed');
    }
  });

  app.post('/api/android/pair-restore', async (c) => {
    // One office IP serves every agent's phone, and the app retries on a bad network.
    if (await ipLimited(c, 'pairrestore', 40)) return c.json({ error: 'Too many attempts — retry in a minute' }, 429);
    const deviceId = String((await readBody(c))?.deviceId ?? '').trim().slice(0, 64);
    if (deviceId.length < 8) return c.json({ error: 'deviceId required' }, 400);
    const out = await restoreByDevice(c.env.DB, deviceId);
    if (out.status === 'paired') notifyLive(c, { type: LiveEvent.DeviceCalls, action: 'restored' });
    return c.json(out);
  });

  app.get('/api/android/dialer/config', async (c) => {
    const auth = await requireDevice(c);
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const cfg = await getConfig(c.env.DB);
    const config = { ...cfg, scheduledBreaks: scheduledFor(cfg, auth.telecallerId) };
    return c.json({ config, telecallerId: auth.telecallerId, serverTime: new Date().toISOString() });
  });

  app.get('/api/android/dialer/queue', async (c) => {
    const auth = await requireDevice(c);
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    return c.json(await listDue(c.env.DB, auth.telecallerId, Number(c.req.query('limit') ?? 50) || 50));
  });

  app.post('/api/android/dialer/sync', async (c) => {
    const auth = await requireDevice(c);
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const result = await applySync(c.env.DB, await readBody(c), {
      id: auth.device.id, deviceId: auth.device.deviceId, telecallerId: auth.telecallerId,
    });
    if (result.storedCalls > 0) invalidateDeviceCallCaches().catch(() => null);
    notifyLive(c, { type: LiveEvent.DeviceCalls, action: 'sync', calls: result.storedCalls });
    return c.json(result);
  });
}

function registerControllerRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/dialer/pair-requests', async (c) => {
    if (!(await manager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    return c.json({ requests: await listPendingRequests(c.env.DB) });
  });

  app.post('/api/dialer/pair-requests/:id/:decision', async (c) => {
    const actor = await manager(c);
    if (!actor) return c.json({ error: 'sales-head or root only' }, 403);
    const decision = c.req.param('decision');
    try {
      if (decision === 'approve') {
        const body = await readBody(c);
        const out = await approveRequest(c.env.DB, c.req.param('id'), String(body?.telecallerId ?? '').trim(), actor);
        notifyLive(c, { type: LiveEvent.DeviceCalls, action: 'paired' });
        return c.json({ ok: true, ...out });
      }
      if (decision !== 'reject') return c.json({ error: 'approve or reject' }, 404);
      await rejectRequest(c.env.DB, c.req.param('id'), actor);
      notifyLive(c, { type: LiveEvent.DeviceCalls, action: 'pair-rejected' });
      return c.json({ ok: true });
    } catch (e) {
      return writeError(c, e, 'pairing failed');
    }
  });

  app.get('/api/dialer/config', async (c) => {
    if (!(await manager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    return c.json({ config: await getConfig(c.env.DB) });
  });

  app.put('/api/dialer/config', async (c) => {
    const actor = await manager(c);
    if (!actor) return c.json({ error: 'sales-head or root only' }, 403);
    try {
      const config = await saveConfig(c.env.DB, await readBody(c), actor);
      notifyLive(c, { type: LiveEvent.DeviceCalls, action: 'config' });
      return c.json({ config });
    } catch (e) {
      return writeError(c, e, 'invalid dialer config');
    }
  });

  app.get('/api/dialer/board', async (c) => {
    if (!(await manager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    const cfg = await getConfig(c.env.DB);
    return c.json({ agents: await liveBoard(c.env.DB, cfg, istDay(new Date())), config: cfg });
  });

  app.get('/api/dialer/report', async (c) => {
    if (!(await manager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    const day = String(c.req.query('day') ?? '');
    const cfg = await getConfig(c.env.DB);
    return c.json({ ...(await dayReport(c.env.DB, cfg, DAY_RE.test(day) ? day : istDay(new Date()))), config: cfg });
  });

  app.get('/api/dialer/app', async (c) => {
    if (!(await manager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    return c.json(await latestAppRelease());
  });

  app.get('/api/dialer/app/download', async (c) => {
    if (!(await manager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    return (await streamLatestApk()) ?? c.json({ error: 'No app build published yet' }, 404);
  });

  app.post('/api/dialer/agents/:telecallerId/reset', async (c) => {
    if (!(await manager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    const body = await readBody(c);
    const out = await resetAgent(c.env.DB, c.env.CALL_RECORDINGS, c.req.param('telecallerId'), istDay(new Date()), body?.wipeToday === true);
    if (out.callsDeleted > 0) invalidateDeviceCallCaches().catch(() => null);
    notifyLive(c, { type: LiveEvent.DeviceCalls, action: 'reset' });
    return c.json({ ok: true, ...out });
  });

  app.get('/api/dialer/unreachable', async (c) => {
    if (!(await manager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    const days = Math.max(1, Math.min(90, Number(c.req.query('days') ?? 7) || 7));
    return c.json({ items: await listUnreachable(c.env.DB, new Date(Date.now() - days * 86_400_000).toISOString()) });
  });

  app.get('/api/dialer/batches', async (c) => {
    if (!(await manager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    const days = Math.max(1, Math.min(90, Number(c.req.query('days') ?? 30) || 30));
    return c.json({ batches: await listBatches(c.env.DB, new Date(Date.now() - days * 86_400_000).toISOString()) });
  });

  app.post('/api/dialer/batches/:batchId/remove', async (c) => {
    if (!(await manager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    const removed = await removeBatch(c.env.DB, c.req.param('batchId'));
    notifyLive(c, { type: LiveEvent.DeviceCalls, action: 'batch-removed' });
    return c.json({ ok: true, removed });
  });

  app.post('/api/dialer/queue/recall', async (c) => {
    if (!(await manager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    const body = await readBody(c);
    const telecallerId = String(body?.telecallerId ?? '').trim();
    if (!telecallerId) return c.json({ error: 'telecallerId required' }, 400);
    const recalled = await recallQueue(c.env.DB, telecallerId, String(body?.batchId ?? '').trim() || undefined);
    notifyLive(c, { type: LiveEvent.DeviceCalls, action: 'recall' });
    return c.json({ ok: true, recalled });
  });
}

export function registerDialerRoutes(app: Hono<{ Bindings: Bindings }>): void {
  registerPhoneRoutes(app);
  registerControllerRoutes(app);
}
