// ─────────────────────────────────────────────────────────────────────────────
// routes/events.ts — live WebSocket events via EventHub Durable Object.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import type { Bindings } from '../context';

export function registerEventsRoute(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/events', (c) => {
    const ns = c.env.EVENT_HUB;
    if (!ns) return c.text('EVENT_HUB not bound', 500);
    const stub = ns.get(ns.idFromName('global'));
    return stub.fetch(new Request('https://hub/stream', c.req.raw));
  });
}