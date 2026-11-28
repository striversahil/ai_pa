// webhooks.ts — the ONE inbound door for every third-party push.
//
//   POST /api/webhooks/:source[/:instanceKey]
//
// Auth is the provider HMAC over the RAW body against the instance's
// webhookSecret. The body is staged in hlp_ingested_data BEFORE any
// normalization; realtime instances process in waitUntil, batch instances
// wait for the ingestion runner. Response is always 202 (fast ACK) so a slow
// mapper can never make a provider retry a row we already stored.

import type { Hono } from 'hono';
import { bindGatewayContext, resolveInstance, IntegrationError } from '../../modules/integrations/gateway';
import { insertIngested } from '../../modules/ingestion/store';
import { processIngestedRow } from '../../modules/ingestion/processor';
import { extractExternalEventId, eventTypeOf, normalizeInboundRequest, signatureHeaders, verifyWebhookSignature } from '../../modules/ingestion/pure';
import { notifyLive, LiveEvent } from '../context';

const MAX_BODY_BYTES = 256 * 1024;

function background(c: any): { waitUntil: (p: Promise<unknown>) => void } | null {
  try {
    const ctx = c.executionCtx;
    return ctx && typeof ctx.waitUntil === 'function' ? ctx : null;
  } catch {
    return null;
  }
}

function safeHeaders(c: any): Record<string, string> {
  const raw = c.req.header();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (/^(authorization|cookie)$/i.test(k)) continue;
    out[k] = String(v ?? '');
  }
  return out;
}

export function registerWebhookRoutes(app: Hono<{ Bindings: any }>): void {
  const handle = async (c: any) => {
    const source = String(c.req.param('source') ?? '').toLowerCase();
    const instanceKey = String(c.req.param('instanceKey') ?? 'default');
    bindGatewayContext({ db: c.env.DB, env: c.env });

    let instance;
    try {
      instance = await resolveInstance(source, { instanceKey });
    } catch (error) {
      const status = error instanceof IntegrationError ? (error.status === 400 ? 404 : error.status) : 500;
      return c.json({ error: (error as Error).message }, status as any);
    }

    const headers = safeHeaders(c);
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.req.query() ?? {})) query[k] = String(v);

    // Meta subscription handshake: echo the challenge, never stage it.
    if (c.req.method === 'GET' && query['hub.mode'] === 'subscribe') {
      const expected = instance.secrets.webhookVerifyToken || '';
      if (!expected || query['hub.verify_token'] !== expected) {
        return c.json({ error: 'verify token mismatch' }, 403);
      }
      return c.text(String(query['hub.challenge'] ?? ''));
    }

    let body: unknown = undefined;
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const text = await c.req.text();
      if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
        return c.json({ error: 'payload too large' }, 413);
      }
      body = text;
    }

    const inbound = normalizeInboundRequest({ method: c.req.method, query, body, headers });
    const secret = instance.secrets.webhookSecret || instance.secrets.appSecret || '';
    if (!secret) return c.json({ error: 'instance has no webhook secret' }, 503);
    const ok = await verifyWebhookSignature(inbound.raw, signatureHeaders(inbound.headers), secret);
    if (!ok) return c.json({ error: 'invalid signature' }, 401);

    const externalEventId = extractExternalEventId(source, inbound.payload);
    const eventType = eventTypeOf(source, inbound.payload);
    const staged = await insertIngested(c.env.DB, {
      source: instance.instanceKey === 'default' ? source : `${source}:${instance.instanceKey}`,
      instanceKey: instance.instanceKey,
      eventType,
      externalEventId,
      deliveryMode: instance.deliveryMode,
      rawPayload: inbound.raw,
      headersJson: JSON.stringify(headers),
    });

    if (instance.deliveryMode === 'realtime' && staged.inserted) {
      const job = processIngestedRow({ db: c.env.DB, env: c.env }, staged.id).then((outcome) => {
        if (outcome.ok) {
          notifyLive(c, { type: LiveEvent.Enquiries, action: 'ingested', id: staged.id });
          notifyLive(c, { type: 'integrations', action: 'processed', id: staged.id });
        }
        return outcome;
      });
      const ctx = background(c);
      if (ctx) ctx.waitUntil(job);
      else await job;
    }

    return c.json({ ok: true, id: staged.id, mode: instance.deliveryMode, duplicate: !staged.inserted }, 202);
  };

  app.all('/api/webhooks/:source', handle);
  app.all('/api/webhooks/:source/:instanceKey', handle);
}
