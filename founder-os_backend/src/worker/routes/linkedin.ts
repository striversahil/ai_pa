// ─────────────────────────────────────────────────────────────────────────────
// routes/linkedin.ts — LinkedIn daily founder-content endpoints.
// Dashboard reads ride the global Google-OAuth session gate (like every other
// /api/* route); the runner ingest is SHARED_SECRET gated like runner.ts.
// Images live in KV (linkedin:img:<postId>, 90-day TTL); text in D1.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, requireSecret, notifyLive, type Bindings } from '../context';
import { prisma } from '../../shared/prisma';
import { cacheGet, cacheSet, cacheDel } from '../../shared/cache';

export const LINKEDIN_IMG_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const linkedinImgKey = (id: string) => `linkedin:img:${id}`;

function istDateString(d: Date): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function registerLinkedinRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // Today's batch for the review card (also served via /api/automations/linkedin/data).
  app.get('/api/linkedin/today', async (c) => {
    const today = istDateString(new Date());
    const rows = await (prisma as any).linkedinPost.findMany({
      where: { batchDate: today },
      orderBy: { createdAt: 'asc' },
    });
    return c.json({
      date: today,
      ready: rows.length > 0,
      posts: (rows as any[]).map((r: any) => ({
        id: String(r.id), topic: r.topic, pillar: r.pillar, format: r.format,
        researchBrief: r.researchBrief, postDraft: r.postDraft, postFinal: r.postFinal,
        hashtags: r.hashtags, visualBrief: r.visualBrief,
        hasImage: !!r.hasImage,
        imageUrl: r.hasImage ? `/api/linkedin/image/${encodeURIComponent(String(r.id))}` : null,
        status: r.status, picked: !!r.picked,
      })),
    });
  });

  // Serve a generated visual (KV base64 → PNG bytes).
  app.get('/api/linkedin/image/:id', async (c) => {
    const b64 = await cacheGet<string>(linkedinImgKey(c.req.param('id')), LINKEDIN_IMG_TTL_MS);
    if (!b64) return c.text('Not found', 404);
    const bytes = Buffer.from(String(b64), 'base64');
    return new Response(bytes as any, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
  });

  // Founder picks 1 of 5 (others stay draft for reuse; picked → approved).
  app.post('/api/linkedin/pick', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const id = String(body?.id ?? '');
    if (!id) return c.json({ ok: false, error: 'id required' }, 400);
    const row = await (prisma as any).linkedinPost.findUnique({ where: { id } });
    if (!row) return c.json({ ok: false, error: 'not found' }, 404);
    await (prisma as any).linkedinPost.update({
      where: { id }, data: { picked: true, status: 'approved' },
    });
    await cacheDel('linkedin:data');
    notifyLive(c, { type: 'linkedin' });
    return c.json({ ok: true });
  });

  // Mark the picked post as posted (manual LinkedIn post done).
  app.post('/api/linkedin/posted', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const id = String(body?.id ?? '');
    if (!id) return c.json({ ok: false, error: 'id required' }, 400);
    await (prisma as any).linkedinPost.update({
      where: { id },
      data: { status: 'posted', postedAt: new Date().toISOString() },
    });
    await cacheDel('linkedin:data');
    notifyLive(c, { type: 'linkedin' });
    return c.json({ ok: true });
  });

  // Runner: slugs used in the last N days (topic rotation).
  app.get('/api/runner/linkedin/used-topics', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const days = Math.max(1, Math.min(90, Number(c.req.query('days') || '14')));
    const since = istDateString(new Date(Date.now() - days * 86400000));
    const rows = await (prisma as any).linkedinPost.findMany({
      where: { batchDate: { gte: since } },
      select: { topic: true },
    });
    return c.json({ topics: [...new Set((rows as any[]).map((r: any) => String(r.topic)))] });
  });

  // Runner ingest: full 5-post batch (idempotent per batchDate+topic).
  app.post('/api/runner/linkedin/batch', async (c) => {
    if (!requireSecret(c)) return c.text('Unauthorized', 401);
    const body = await c.req.json().catch(() => ({}));
    const batchDate = String(body?.batchDate ?? istDateString(new Date()));
    const posts = Array.isArray(body?.posts) ? body.posts : [];
    if (!posts.length) return c.json({ ok: false, error: 'posts required' }, 400);
    const { cacheSet: set } = { cacheSet };
    let stored = 0;
    for (const p of posts.slice(0, 8)) {
      if (!p?.topic || !p?.postFinal) continue;
      const topic = String(p.topic);
      const text = {
        pillar: String(p.pillar ?? ''), format: String(p.format ?? ''),
        researchBrief: String(p.researchBrief ?? ''), postDraft: String(p.postDraft ?? ''),
        postFinal: String(p.postFinal ?? ''), hashtags: String(p.hashtags ?? ''),
        visualBrief: String(p.visualBrief ?? ''), imagePrompt: String(p.imagePrompt ?? ''),
      };
      // findFirst with plain equality — the D1 shim has no composite-unique
      // where support (@@unique is a DB-level guard only).
      const existing = await (prisma as any).linkedinPost.findFirst({
        where: { batchDate, topic },
      });
      const row = existing
        ? await (prisma as any).linkedinPost.update({ where: { id: String(existing.id) }, data: text })
        : await (prisma as any).linkedinPost.create({ data: { batchDate, topic, ...text, status: 'draft' } });
      if (p.imageB64 && typeof p.imageB64 === 'string' && p.imageB64.length > 1000) {
        await set(linkedinImgKey(String(row.id)), p.imageB64, LINKEDIN_IMG_TTL_MS);
        await (prisma as any).linkedinPost.update({ where: { id: String(row.id) }, data: { hasImage: true } });
      }
      stored++;
    }
    const { cacheDel: del } = { cacheDel };
    await del('linkedin:data');
    notifyLive(c, { type: 'linkedin' });
    return c.json({ ok: true, stored });
  });
}
