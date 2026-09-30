// ─────────────────────────────────────────────────────────────────────────────
// routes/linkedin.ts — LinkedIn daily founder-content endpoints.
// Dashboard reads ride the global Google-OAuth session gate (like every other
// /api/* route); the runner ingest is SHARED_SECRET gated like runner.ts.
// Images live in KV (linkedin:img:<postId>, 90-day TTL); text in D1.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, requireSecret, notifyLive, authStore, getMe, isApproved, type Bindings } from '../context';
import { prisma } from '../../shared/prisma';
import { cacheGet, cacheDel } from '../../shared/cache';

export const LINKEDIN_IMG_KEY = (id: string) => `linkedin/${id}.png`;

// Signed image URLs: <img> subresource requests don't reliably carry the
// session cookie through the Pages-Function proxy (seen live: identical fetch
// passes, <img> 401s), so visuals carry their own unguessable credential.
// HMAC-SHA256 over the post id with SHARED_SECRET (server-side only — just
// the MAC is exposed); subtle.verify is timing-safe. The session check stays
// as a fallback path.
function b64urlEncode(buf: ArrayBuffer): string {
  // Manual base64url (not Buffer 'base64url' — encoding support varies across
  // edge runtimes; plain 'base64' + char-swap is universal).
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (s.length % 4)) % 4);
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

async function signImageId(c: any, id: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(c.env.SHARED_SECRET ?? '')),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`linkedin-img:${id}`));
  return b64urlEncode(sig);
}

async function verifyImageSig(c: any, id: string, sig: string | null | undefined): Promise<boolean> {
  try {
    if (!sig || !c.env.SHARED_SECRET) return false;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(String(c.env.SHARED_SECRET ?? '')),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
    );
    return await crypto.subtle.verify('HMAC', key, b64urlDecode(sig) as any, new TextEncoder().encode(`linkedin-img:${id}`));
  } catch {
    return false;
  }
}

async function imageUrlFor(c: any, id: string): Promise<string> {
  return `/api/linkedin/image/${encodeURIComponent(id)}?sig=${encodeURIComponent(await signImageId(c, id))}`;
}

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
      // A signing failure must never nuke the batch — fall back to the
      // unsigned URL (session check) for that row.
      let imageUrl: string | null = null;
      if (r.hasImage) {
        try {
          imageUrl = await imageUrlFor(c, String(r.id));
        } catch {
          imageUrl = `/api/linkedin/image/${encodeURIComponent(String(r.id))}`;
        }
      }
      posts.push({
        id: String(r.id), topic: r.topic, pillar: r.pillar, format: r.format,
        researchBrief: r.researchBrief, postDraft: r.postDraft, postFinal: r.postFinal,
        hashtags: r.hashtags, visualBrief: r.visualBrief,
        hasImage: !!r.hasImage, imageUrl,
        status: r.status, picked: !!r.picked,
      });
    }
    return c.json({ date: today, ready: posts.length > 0, posts });
  });

  // Serve the visual — same proven pattern as /api/crm/files/:id (raw bytes
  // in CHAT_FILES, explicit session check, immutable caching). Falls back to
  // the first-day cache-envelope keys so the 30/09 batch keeps working.
  app.get('/api/linkedin/image/:id', async (c) => {
    const id = c.req.param('id') ?? '';
    // Signed URL first (no session needed); session check as fallback.
    let authed = await verifyImageSig(c, id, c.req.query('sig'));
    if (!authed) {
      const me = await getMe(authStore(c), c.req.header('cookie') ?? null);
      authed = !!me && isApproved(me);
    }
    if (!authed) return c.json({ error: 'Authentication required' }, 401);
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
      const bin = Uint8Array.from(Buffer.from(String(b64), 'base64'));
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
          const bin = Uint8Array.from(Buffer.from(p.imageB64, 'base64'));
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
