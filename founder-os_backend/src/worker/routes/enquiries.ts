// ─────────────────────────────────────────────────────────────────────────────
// routes/enquiries.ts — live sales-pipeline enquiry tracker.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { enquiryMe, enquirySend, runEnquiryExtraction, EnquiryRoutes, createEnquiryStore, authStore, deps, type Bindings } from '../context';

export function registerEnquiryRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/enquiries', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    // ?view=procurement lets privileged users (root/MIS) preview exactly what
    // procurement sees — the AI-redacted payload, not their full data.
    const restricted = c.req.query('view') === 'procurement' || EnquiryRoutes.isRestrictedViewer(me);
    const r = await EnquiryRoutes.enquiryList(createEnquiryStore(c.env), me, restricted ? { redact: true } : undefined);
    // Cache miss on any piece → background re-enrichment (fire-and-forget);
    // the client refetches on the live event it broadcasts.
    if (restricted) {
      for (const id of ((r.body as any)?.redactionPendingIds ?? []) as string[]) {
        try { runEnquiryExtraction(c, String(id)); } catch { /* ignore */ }
      }
    }
    return c.json(r.body, r.status as any);
  });
  app.get('/api/enquiries/agents', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    // Restricted (procurement) viewers get NO roster — without names, the
    // stored lead ids can't be resolved to a person on their screen.
    if (c.req.query('view') === 'procurement' || EnquiryRoutes.isRestrictedViewer(me)) return c.json([]);
    // "Lead by" roster = ACTIVE + PRESENT sales staff, exactly like the
    // telecalling dashboard: Telecaller rows that are not soft-deleted and not
    // marked absent (absentSince set by the MIS Controller). Filtered in code
    // (not in the D1 where-clause) so a shim null-handling quirk can never
    // leak absent staff into the list.
    const { prisma } = deps();
    const roster = await prisma.telecaller.findMany({ where: { deleted: false }, orderBy: { order: 'asc' } });
    const agents = (roster as any[])
      .filter((t) => t && !(t as any).absentSince)
      .map((t: any) => ({
        id: String(t.id),
        name: t.name,
        email: t.email ?? null,
        picture: null,
      }));
    return c.json(agents);
  });
  app.post('/api/enquiries', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await EnquiryRoutes.enquiryCreate(createEnquiryStore(c.env), me, await c.req.json().catch(() => ({})));
    enquirySend(c, r);
    if (r.body?.id) runEnquiryExtraction(c, r.body.id);
    return c.json(r.body, r.status as any);
  });
  app.patch('/api/enquiries/:id', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await EnquiryRoutes.enquiryUpdate(createEnquiryStore(c.env), me, c.req.param('id') ?? '', await c.req.json().catch(() => ({})));
    enquirySend(c, r);
    if (r.body?.id) runEnquiryExtraction(c, r.body.id);
    return c.json(r.body, r.status as any);
  });
  app.post('/api/enquiries/:id/additional-requirements', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await EnquiryRoutes.enquiryAddRequirement(createEnquiryStore(c.env), me, c.req.param('id') ?? '', await c.req.json().catch(() => ({})));
    enquirySend(c, r);
    return c.json(r.body, r.status as any);
  });
  app.delete('/api/enquiries/:id', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await EnquiryRoutes.enquiryDelete(createEnquiryStore(c.env), me, c.req.param('id') ?? '');
    enquirySend(c, r);
    if (r.status === 200) {
      try {
        const { cacheDel } = require('../../shared/cache');
        await cacheDel(`enquiry:redacted:${c.req.param('id') ?? ''}`);
      } catch { /* best-effort */ }
    }
    return c.json(r.body, r.status as any);
  });
  app.get('/api/enquiries/:id/comments', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const restricted = c.req.query('view') === 'procurement' || EnquiryRoutes.isRestrictedViewer(me);
    const r = await EnquiryRoutes.enquiryComments(createEnquiryStore(c.env), me, c.req.param('id') ?? '', restricted ? { redact: true } : undefined);
    if (restricted) {
      for (const id of ((r.body as any)?.redactionPendingIds ?? []) as string[]) {
        try { runEnquiryExtraction(c, String(id)); } catch { /* ignore */ }
      }
    }
    return c.json(r.body, r.status as any);
  });
  app.post('/api/enquiries/:id/comments', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    const r = await EnquiryRoutes.enquiryAddComment(createEnquiryStore(c.env), me, c.req.param('id') ?? '', await c.req.json().catch(() => ({})));
    enquirySend(c, r);
    // The agent writes the lead-details block in the first 1–2 comments — run
    // extraction so enquiryNumber/sourceLead/location/company/contact fill in.
    if (r.body?.enquiryId) runEnquiryExtraction(c, r.body.enquiryId);
    return c.json(r.body, r.status as any);
  });
}