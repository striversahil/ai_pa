// ─────────────────────────────────────────────────────────────────────────────
// routes/enquiry-threads.ts — per-item conversations between the Sales,
// Procurement and Management desks (founder ask 2026-11-20). Worker-only.
//
// Every call names the acting `desk`; the service checks the login may act as
// that desk and serves only that desk's channels. Sales never receives an
// internal (management <-> procurement) thread — list, inbox or by id.
// Live events carry ids only (no text), so the EventHub leaks nothing.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { notifyLive, type Bindings } from '../context';
import { getViewerMe } from '../viewer';
import { readBody } from '../http';
import {
  actOnThread, forwardToProcurement, startThread, threadCounts, threadInbox, threadsForEnquiry,
} from '../../modules/enquiry-threads/service';

function send(c: any, r: { ok: true; value: unknown } | { ok: false; status: number; error: string }, key: string, status = 200) {
  return r.ok ? c.json({ [key]: r.value }, status) : c.json({ error: r.error }, r.status);
}

function live(c: any, action: string, r: any) {
  if (r?.ok) notifyLive(c, { type: 'enquiry-threads' as any, action, enquiryId: r.value?.enquiryId, id: r.value?.id });
}

export function registerEnquiryThreadRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/enquiry-threads', async (c) =>
    send(c, await threadsForEnquiry(c.env.DB, await getViewerMe(c), c.req.query('desk'), c.req.query('enquiryId') ?? ''), 'threads'));

  app.get('/api/enquiry-threads/inbox', async (c) =>
    send(c, await threadInbox(c.env.DB, await getViewerMe(c), c.req.query('desk'), c.req.query('status')), 'threads'));

  app.get('/api/enquiry-threads/counts', async (c) =>
    send(c, await threadCounts(c.env.DB, await getViewerMe(c), c.req.query('desk')), 'counts'));

  app.post('/api/enquiry-threads', async (c) => {
    const r = await startThread(c.env.DB, await getViewerMe(c), await readBody(c));
    live(c, 'created', r);
    return send(c, r, 'thread', 201);
  });

  for (const op of ['reply', 'resolve', 'reopen'] as const) {
    app.post(`/api/enquiry-threads/:id/${op}`, async (c) => {
      const r = await actOnThread(c.env.DB, await getViewerMe(c), c.req.param('id') ?? '', await readBody(c), op);
      live(c, op, r);
      return send(c, r, 'thread');
    });
  }

  app.post('/api/enquiry-threads/:id/forward', async (c) => {
    const r = await forwardToProcurement(c.env.DB, await getViewerMe(c), c.req.param('id') ?? '', await readBody(c));
    live(c, 'forwarded', r);
    return send(c, r, 'thread', 201);
  });
}
