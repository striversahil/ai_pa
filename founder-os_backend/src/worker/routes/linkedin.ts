// ─────────────────────────────────────────────────────────────────────────────
// routes/linkedin.ts — LinkedIn daily founder-content endpoints.
// Dashboard reads ride the global Google-OAuth session gate (like every other
// /api/* route); the runner ingest is SHARED_SECRET gated like runner.ts.
// Images live in KV (linkedin:img:<postId>, 90-day TTL); text in D1.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { requireSecret, notifyLive, type Bindings } from '../context';
import { prisma } from '../../shared/prisma';
import { cacheGet, cacheDel } from '../../shared/cache';

// atob-based base64 → bytes (no Buffer dependency — edge Buffer support for
// binary builtins proved unreliable live; atob is universal in workers).
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const LINKEDIN_IMG_KEY = (id: string) => `linkedin/${id}.png`;

// Visuals are PUBLIC-BY-DESIGN (marketing diagrams destined for LinkedIn
// within hours — UUID v4 ids are unguessable, enumeration is infeasible).
// This is deliberate: <img> subresource requests proved unable to carry auth
// reliably through the Pages-Function proxy (live 401s on every gated
// variant — session check and HMAC-signed URLs alike), and the bytes carry no
// sensitive content. Everything sensitive (draft text, research, pick/posted
// actions, batch ingest) stays behind the session gate / SHARED_SECRET. Never
// extend this open serving to any other content type without review.

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
    const posts: any[] = [];
    for (const r of (rows as any[])) {
      posts.push({
        id: String(r.id), topic: r.topic, pillar: r.pillar, format: r.format,
        researchBrief: r.researchBrief, postDraft: r.postDraft, postFinal: r.postFinal,
        hashtags: r.hashtags, visualBrief: r.visualBrief,
        hasImage: !!r.hasImage,
        imageUrl: r.hasImage ? `/api/linkedin/image/${encodeURIComponent(String(r.id))}` : null,
        status: r.status, picked: !!r.picked,
      });
    }
    return c.json({ date: today, ready: posts.length > 0, posts });
  });

  // Serve the visual — NO auth gate (public-by-design, see header note;
  // exempted in AUTH_EXEMPT so the global Google-OAuth gate skips it).
  // Raw bytes in CHAT_FILES, immutable caching; falls back to the first-day
  // cache-envelope keys so the 30/09 batch keeps working.
  app.get('/api/linkedin/image/:id', async (c) => {
    const id = c.req.param('id') ?? '';
    if (c.env.CHAT_FILES) {
      const obj = await c.env.CHAT_FILES.getWithMetadata(LINKEDIN_IMG_KEY(id), 'arrayBuffer').catch(() => null);
      if (obj?.value) {
        const headers = new Headers();
        headers.set('Content-Type', 'image/png');
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        return new Response(obj.value, { headers });
      }
    }
    // Legacy fallback: 30/09 batch stored envelopes in the shared cache KV.
    const b64 = await cacheGet<string>(`linkedin:img:${id}`, 90 * 24 * 60 * 60 * 1000).catch(() => null);
    if (b64) {
      const bin = b64ToBytes(b64);
      return new Response(bin as any, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
    }
    return c.json({ error: 'File not found' }, 404);
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
      if (p.imageB64 && typeof p.imageB64 === 'string' && p.imageB64.length > 1000 && c.env.CHAT_FILES) {
        try {
          const bin = b64ToBytes(p.imageB64);
          await c.env.CHAT_FILES.put(LINKEDIN_IMG_KEY(String(row.id)), bin as any, {
            metadata: { name: `${topic}.png`, type: 'image/png' },
          });
          await (prisma as any).linkedinPost.update({ where: { id: String(row.id) }, data: { hasImage: true } });
        } catch (e: any) {
          console.warn(`linkedin: image store failed for ${topic}: ${e?.message}`);
        }
      }
      stored++;
    }
    const { cacheDel: del } = { cacheDel };
    await del('linkedin:data');
    notifyLive(c, { type: 'linkedin' });
    return c.json({ ok: true, stored });
  });
}
