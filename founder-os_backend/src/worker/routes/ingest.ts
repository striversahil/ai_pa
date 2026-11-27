// routes/ingest.ts — the PUBLIC webhook door: /api/ingest/:sourceId/:token.
//
// AUTH_EXEMPT (a portal has no session cookie). The path token is the
// credential (only its SHA-256 is in D1) and an optional per-source HMAC
// signature is verified over the RAW body. Every call is recorded as a
// delivery, accepted or not, so the panel can show what arrived and replay.
import type { Hono } from 'hono';
import type { Bindings } from '../context';
import { notifyLive } from '../context';
import * as store from '../../modules/integrations/store';
import * as svc from '../../modules/integrations/service';

const MAX_BODY_BYTES = 256 * 1024;

function headerMap(c: any): Record<string, string> {
  const out: Record<string, string> = {};
  const h = c.req.raw?.headers;
  if (h) h.forEach((v: string, k: string) => { out[String(k).toLowerCase()] = v; });
  return out;
}

function kv(c: any) {
  return (c.env as any).CACHE_KV as any;
}

export function registerIngestRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // The webhook itself. 202 = stored (Tally retries only on non-2xx, and the
  // UNIQUE(sourceId, externalId) index makes a retry a no-op duplicate).
  app.post('/api/ingest/:sourceId/:token', async (c) => {
    const db = (c.env as any).DB;
    const sourceId = c.req.param('sourceId');
    const token = c.req.param('token');
    const raw = await c.req.text();
    if (raw.length > MAX_BODY_BYTES) return c.json({ ok: false, error: 'Payload too large' }, 413);
    const source = await store.getSource(db, sourceId);
    if (!source) return c.json({ ok: false, error: 'Not found' }, 404);
    const connector = await svc.entryForSource(db, source);
    const out = await svc.ingest({ db, kv: kv(c), source, connector, token, raw, headers: headerMap(c) });
    if (out.status === 202 && out.body.eventId) {
      notifyLive(c, { type: 'ingest', sourceId, eventId: out.body.eventId });
    }
    return c.json(out.body, out.status as any);
  });

  // Human check + provider verification handshake (Meta hub.challenge).
  app.get('/api/ingest/:sourceId/:token', async (c) => {
    const db = (c.env as any).DB;
    const sourceId = c.req.param('sourceId');
    const token = c.req.param('token');
    const source = await store.getSource(db, sourceId);
    if (!source) return c.json({ ok: false, error: 'Not found' }, 404);
    const expected = await svc.sha256Hex(token);
    if (expected !== String(source.tokenHash ?? '') || source.status !== 'active') {
      return c.json({ ok: false, error: 'Not found' }, 404);
    }
    if (c.req.query('hub.mode') === 'subscribe') {
      const verify = await svc.getSecret(kv(c), source.id, 'verifyToken');
      if (verify && c.req.query('hub.verify_token') === verify) {
        return c.text(String(c.req.query('hub.challenge') ?? ''), 200);
      }
      return c.json({ ok: false, error: 'Verification failed' }, 403);
    }
    const connector = await svc.entryForSource(db, source);
    return c.json({ ok: true, source: { id: source.id, name: source.name, status: source.status, connector: connector.name } });
  });
}
