// ─────────────────────────────────────────────────────────────────────────────
// routes/android.ts — device-token API used by the Android call app.
//
// Every route is AUTH_EXEMPT (the Google gate would reject a bearer token) and
// enforces `requireDevice`. Pairing is the only unauthenticated write; it is
// code-gated and IP rate-limited. Handlers stay thin: parsing in
// modules/device-calls/parse.ts, persistence in store.ts.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { notifyLive, LiveEvent, type Bindings } from '../context';
import { requireDevice } from '../../modules/device-calls/scopes';
import { normalizePairCode, randomToken, hashToken } from '../../modules/device-calls/tokens';
import { parseBatch } from '../../modules/device-calls/parse';
import {
  createDevice,
  findPairCode,
  getCall,
  insertCalls,
  setRecording,
  touchDevice,
} from '../../modules/device-calls/store';
import { MAX_RECORDING_BYTES, PART_MINUTES, MAX_CALL_MINUTES } from '../../modules/device-calls/types';
import { cacheGet, cacheSet } from '../../shared/cache';
import { invalidateDeviceCallCaches } from '../../automations/telecalling/device-calls';

const DEFAULT_CONFIG = {
  loggingOnlyFallback: false,
  maxBytes: MAX_RECORDING_BYTES,
  maxMinutes: MAX_CALL_MINUTES,
  partMinutes: PART_MINUTES,
};

async function config(): Promise<typeof DEFAULT_CONFIG> {
  try {
    const { getAppSettings } = await import('../../shared/app-settings');
    const settings = await getAppSettings();
    const raw = settings['device:call_config'];
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      loggingOnlyFallback: !!parsed.loggingOnlyFallback,
      maxBytes: Number(parsed.maxBytes) > 0 ? Number(parsed.maxBytes) : DEFAULT_CONFIG.maxBytes,
      maxMinutes: Number(parsed.maxMinutes) > 0 ? Number(parsed.maxMinutes) : DEFAULT_CONFIG.maxMinutes,
      partMinutes: Number(parsed.partMinutes) > 0 ? Number(parsed.partMinutes) : DEFAULT_CONFIG.partMinutes,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function registerAndroidRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Pairing (one-time code → long-lived device token) ──────────────────────
  app.post('/api/android/pair', async (c) => {
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateKey = `device:pair:${ip}`;
    const hits = Number((await cacheGet<number>(rateKey, 60_000).catch(() => 0)) ?? 0);
    if (hits >= 10) return c.json({ error: 'Too many pairing attempts — retry in a minute' }, 429);
    await cacheSet(rateKey, hits + 1, 60_000).catch(() => null);

    const body = await c.req.json().catch(() => ({}));
    const code = normalizePairCode(body?.code);
    const deviceId = String(body?.deviceId ?? '').trim().slice(0, 64);
    const label = String(body?.label ?? '').trim().slice(0, 120);
    const appVersion = String(body?.appVersion ?? '').trim().slice(0, 40);
    if (!code) return c.json({ error: 'code required' }, 400);
    if (deviceId.length < 8) return c.json({ error: 'deviceId required' }, 400);

    const row: any = await findPairCode(c.env.DB, code);
    if (!row) return c.json({ error: 'code invalid, used or expired' }, 404);

    const token = randomToken();
    const tokenHash = await hashToken(token);
    const me = String(body?.pairedByName ?? '').slice(0, 120);
    await createDevice(c.env.DB, {
      telecallerId: String(row.telecallerId),
      deviceId,
      tokenHash,
      label,
      appVersion,
      pairedBy: String(row.createdBy ?? ''),
      pairedByName: me,
      pairCode: code,
    });
    const agent: any = await c.env.DB.prepare('SELECT name FROM Telecaller WHERE id = ? LIMIT 1')
      .bind(row.telecallerId).first();
    notifyLive(c, { type: LiveEvent.DeviceCalls, action: 'paired' });
    return c.json({
      ok: true,
      token,
      deviceId,
      agent: String(agent?.name ?? ''),
      loggingOnly: false,
    }, 201);
  });

  // ── Heartbeat: config + server time + logging-only flag ───────────────────
  app.post('/api/android/heartbeat', async (c) => {
    const auth = await requireDevice(c);
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const body = await c.req.json().catch(() => ({}));
    await touchDevice(c.env.DB, auth.device.id, String(body?.appVersion ?? '')).catch(() => null);
    if (body?.consent === true && !auth.device.consentAt) {
      await c.env.DB.prepare('UPDATE DeviceRegistration SET consentAt=? WHERE id=?')
        .bind(new Date().toISOString(), auth.device.id).run().catch(() => null);
    }
    const cfg = await config();
    return c.json({
      loggingOnly: !!auth.device.loggingOnly || cfg.loggingOnlyFallback,
      maxBytes: cfg.maxBytes,
      maxMinutes: cfg.maxMinutes,
      partMinutes: cfg.partMinutes,
      serverTime: new Date().toISOString(),
    });
  });

  // ── Call log batch ─────────────────────────────────────────────────────────
  app.post('/api/android/calls', async (c) => {
    const auth = await requireDevice(c);
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const parsed = await parseBatch(body, auth.device.deviceId);
    if (parsed.calls.length === 0) return c.json({ accepted: 0, duplicates: 0, errors: parsed.errors }, 400);
    const accepted = await insertCalls(c.env.DB, parsed.calls, auth.telecallerId);
    invalidateDeviceCallCaches().catch(() => null);
    touchDevice(c.env.DB, auth.device.id).catch(() => null);
    notifyLive(c, { type: LiveEvent.DeviceCalls, action: 'ingest', count: accepted });
    return c.json({ accepted, duplicates: 0, errors: parsed.errors });
  });

  // ── Recording upload (one part per request) ────────────────────────────────
  app.put('/api/android/recordings/:callId', async (c) => {
    const auth = await requireDevice(c);
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    if (!c.env.CALL_RECORDINGS) return c.json({ error: 'recording storage is not configured' }, 501);
    const call: any = await getCall(c.env.DB, c.req.param('callId'));
    if (!call) return c.json({ error: 'call not found' }, 404);
    if (String(call.telecallerId) !== auth.telecallerId || String(call.deviceId) !== auth.device.deviceId) {
      return c.json({ error: 'not your call' }, 403);
    }
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > MAX_RECORDING_BYTES) return c.json({ error: 'recording too large' }, 413);
    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength === 0) return c.json({ error: 'empty body' }, 400);
    const part = Math.max(0, Math.min(Number(c.req.query('part') ?? 0) || 0, 59));
    const day = String(call.attemptAt).slice(0, 7);
    const key = `calls/${day}/${String(auth.telecallerId).replace(/[^A-Za-z0-9_-]/g, '_')}/${call.id}-${part}.m4a`;
    await c.env.CALL_RECORDINGS.put(key, bytes, {
      httpMetadata: { contentType: 'audio/mp4' },
      customMetadata: { callId: String(call.id), telecallerId: auth.telecallerId, part: String(part) },
    });
    await setRecording(c.env.DB, call.id, { key, bytes: bytes.byteLength, parts: part + 1, state: 'uploaded' });
    notifyLive(c, { type: LiveEvent.DeviceCalls, action: 'recording', callId: call.id });
    return c.json({ ok: true, key: key.split('/').pop(), bytes: bytes.byteLength, part });
  });

  app.post('/api/android/calls/:callId/recording-empty', async (c) => {
    const auth = await requireDevice(c);
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    const call: any = await getCall(c.env.DB, c.req.param('callId'));
    if (!call) return c.json({ error: 'call not found' }, 404);
    if (String(call.telecallerId) !== auth.telecallerId || String(call.deviceId) !== auth.device.deviceId) {
      return c.json({ error: 'not your call' }, 403);
    }
    await setRecording(c.env.DB, call.id, { state: 'empty' });
    return c.json({ ok: true });
  });
}
