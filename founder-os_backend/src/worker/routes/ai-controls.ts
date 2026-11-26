// routes/ai-controls.ts — pool switches + telemetry drill-down (root only).
//
// Provider/key enable is a persisted Setting change (ai:providers[].enabled /
// keys[].enabled). It is a PURE FILTER at selection time: disabling never
// deletes a key or its history, and re-enabling restores it immediately.
// Manual re-enable also stamps healthResetAt so the score that disabled it
// cannot immediately disable it again.
import type { Hono } from 'hono';
import { notifyLive, type Bindings } from '../context';
import { LiveEvent } from '../../live';
import { readBody } from '../http';
import { gatewayForRequest, rootOnly } from './ai-shared';
import { listKeyCalls, loadRedactedProviders, setKeyEnabled, setProviderEnabled } from '../ai-gateway-health';

async function afterWrite(c: any) {
  // Apply the switch to THIS isolate's live pool immediately (the Setting is
  // authoritative on the next request anyway; this avoids waiting a turn).
  try { await gatewayForRequest(c); } catch { /* next request re-applies */ }
  try { notifyLive(c, { type: LiveEvent.Settings }); } catch { /* non-fatal */ }
  return c.json({ ok: true, ...(await loadRedactedProviders(c.env as any)) });
}

export function registerAiControlRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // Provider-level switch: off = none of its keys compete for traffic.
  app.patch('/api/ai/providers/:id', async (c) => {
    if (!(await rootOnly(c))) return c.json({ error: 'Root only' }, 403);
    const body = await readBody(c);
    const enabled = (body as any)?.enabled;
    if (typeof enabled !== 'boolean') return c.json({ error: 'enabled:boolean required' }, 400);
    try {
      await setProviderEnabled(c.env as any, String(c.req.param('id') ?? ''), enabled);
      return afterWrite(c);
    } catch (e: any) {
      const msg = String(e?.message ?? 'save failed');
      return c.json({ error: msg.slice(0, 200) }, msg.startsWith('unknown') ? 404 : 400);
    }
  });

  // Per-key switch. :kid is the fingerprint id (provider:first6...last4) —
  // URL-encode it; no secret material is ever accepted or returned.
  app.patch('/api/ai/providers/:id/keys/:kid', async (c) => {
    if (!(await rootOnly(c))) return c.json({ error: 'Root only' }, 403);
    const body = await readBody(c);
    const enabled = (body as any)?.enabled;
    if (typeof enabled !== 'boolean') return c.json({ error: 'enabled:boolean required' }, 400);
    try {
      await setKeyEnabled(c.env as any, String(c.req.param('id') ?? ''), decodeURIComponent(String(c.req.param('kid') ?? '')), enabled);
      return afterWrite(c);
    } catch (e: any) {
      const msg = String(e?.message ?? 'save failed');
      return c.json({ error: msg.slice(0, 200) }, msg.startsWith('unknown') ? 404 : 400);
    }
  });

  // Recent per-call ledger (newest first, 24 h window) for the drill-down.
  app.get('/api/ai/key-calls', async (c) => {
    if (!(await rootOnly(c))) return c.json({ error: 'Root only' }, 403);
    try {
      const rows = await listKeyCalls(c.env as any, Number(c.req.query('limit') ?? 100));
      return c.json({ ok: true, rows });
    } catch (e: any) {
      return c.json({ error: String(e?.message ?? 'read failed').slice(0, 200) }, 500);
    }
  });
}
