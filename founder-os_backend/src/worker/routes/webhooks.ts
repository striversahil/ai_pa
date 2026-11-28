// webhooks.ts — the ONE inbound door for every third-party push.
//
//   GET|POST /api/webhooks/:source[/:instanceKey]
//
// Everything provider-specific comes from manifest.json: whether the
// provider accepts pushes, its challenge handshake, verification kind
// (hmac / field_match / optional_header_token), idempotency key and live
// event. Raw body is staged in hlp_ingested_data BEFORE any normalization;
// realtime instances process in waitUntil, batch instances wait for the
// ingestion runner. Response is always 202 so a slow mapper can never make a
// provider retry a row we already stored.

import type { Hono } from 'hono';
import { bindGatewayContext, resolveInstance, IntegrationError } from '../../modules/integrations/gateway';
import { getProviderManifest } from '../../modules/integrations/gateway/manifest';
import { insertIngested } from '../../modules/ingestion/store';
import { processIngestedRow } from '../../modules/ingestion/processor';
import {
  extractIdempotencyKey,
  eventTypeOf,
  normalizeInboundRequest,
  verifyInbound,
} from '../../modules/ingestion/pure';
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
    const manifest = getProviderManifest(source);
    if (!manifest || !manifest.inbound.supported) {
      return c.json({ error: `not a webhook provider: ${source}` }, 404);
    }
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

    // Meta-family subscription handshake: echo the challenge, never stage it.
    const challenge = manifest.inbound.challengeGet;
    if (c.req.method === 'GET' && challenge && query[challenge.modeParam] === challenge.expectedMode) {
      const expected = String(
        instance.config.verifyToken || instance.secrets.verifyToken || instance.secrets.webhookVerifyToken || '',
      );
      if (!expected || query[challenge.tokenParam] !== expected) {
        return c.json({ error: 'verify token mismatch' }, 403);
      }
      return c.text(String(query[challenge.challengeParam] ?? ''));
    }

    let body: unknown = undefined;
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const text = await c.req.text();
      if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
        return c.json({ error: 'payload too large' }, 413);
      }
      body = text;
    }

    const inbound = normalizeInboundRequest({ method: c.req.method, provider: source, query, body, headers });
    const check = await verifyInbound(source, {
      raw: inbound.raw,
      payload: inbound.payload,
      headers: inbound.headers,
      config: instance.config,
      secrets: instance.secrets,
    });
    if (!check.ok) {
      // Mirror the failure reason into logs (never the header VALUE): Tally's
      // portal only shows the status code, so this is the only way to tell an
      // unsigned delivery from a wrong signing secret.
      console.log(JSON.stringify({
        tag: 'webhook_verify_failed',
        source,
        reason: check.reason || 'invalid signature',
        signatureHeaders: Object.keys(headers).filter((k) => /signature/i.test(k)),
        contentType: headers['content-type'] || '',
        bodyBytes: inbound.raw.length,
      }));
      const status = check.reason?.includes('not configured') ? 503 : 401;
      return c.json({ error: check.reason || 'invalid signature' }, status);
    }

    const externalEventId = extractIdempotencyKey(source, inbound.payload, instance.config);
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
          const wanted = manifest.inbound.liveEvent || 'integrations';
          const known = Object.values(LiveEvent) as string[];
          const live = known.includes(wanted) ? wanted : LiveEvent.Integrations;
          notifyLive(c, { type: live as any, action: 'ingested', id: staged.id });
          if (live !== LiveEvent.Integrations) {
            notifyLive(c, { type: LiveEvent.Integrations, action: 'processed', id: staged.id });
          }
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
