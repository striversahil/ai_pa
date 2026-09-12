// ─────────────────────────────────────────────────────────────────────────────
// routes/crm-attachments.ts — SO document attachments (accounts uploads).
//
// Invoice PDFs, LR copies, PODs attached to a sales order from the CRM
// dashboard. Metadata is durable in D1 (SoAttachment, keyed by SO number —
// snapshot refreshes can never wipe it); file bytes live in Workers KV
// (CHAT_FILES, same locker as team-chat files). Upload/delete are MIS-only;
// listing/download is any approved member. Every mutation busts the cached
// CRM payload and broadcasts LiveEvent.Crm so open tabs refetch.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import {
  authStore, getMe, isApproved, requireMisScope, misScopeError,
  notifyLive, broadcastLive, LiveEvent, MAX_ATTACHMENT_BYTES, deps,
  type Bindings,
} from '../context';
import { cacheDel } from '../../shared/cache';

const CRM_DATA_CACHE_KEY = 'crm:data';
const VALID_KINDS = new Set(['invoice', 'lr', 'pod', 'other']);

function isAllowedMime(mime: string): boolean {
  return mime === 'application/pdf' || mime.startsWith('image/');
}

function toJson(row: any) {
  return {
    id: String(row?.id ?? ''),
    soNumber: String(row?.soNumber ?? ''),
    kind: String(row?.kind ?? 'other'),
    fileName: String(row?.fileName ?? ''),
    mime: String(row?.mime ?? 'application/octet-stream'),
    size: Number(row?.size ?? 0),
    uploadedBy: String(row?.uploadedBy ?? ''),
    createdAt: row?.createdAt instanceof Date ? row.createdAt.toISOString() : String(row?.createdAt ?? ''),
    url: `/api/crm/files/${String(row?.id ?? '')}`,
  };
}

export function registerCrmAttachmentRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // Upload: MIS only (accounts desk works under the MIS grant).
  app.post('/api/crm/attachments', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: 'Expected multipart/form-data' }, 400);
    }
    const soNumber = String(form.get('soNumber') || '').trim();
    const kind = String(form.get('kind') || 'other').trim().toLowerCase();
    const file = form.get('file');
    if (!soNumber) return c.json({ error: 'soNumber required' }, 400);
    if (!VALID_KINDS.has(kind)) return c.json({ error: 'kind must be one of invoice|lr|pod|other' }, 400);
    if (!(file instanceof File)) return c.json({ error: 'file field required' }, 400);
    const mime = file.type || 'application/octet-stream';
    if (!isAllowedMime(mime)) return c.json({ error: 'Only PDF and image files can be attached' }, 400);
    if (file.size > MAX_ATTACHMENT_BYTES) return c.json({ error: 'File too large (max 20MB)' }, 413);
    if (file.size <= 0) return c.json({ error: 'Empty file' }, 400);
    const me = await getMe(authStore(c), c.req.header('cookie') ?? null);
    const actor = me?.user?.name || me?.user?.email || 'MIS';
    const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const key = `so/${soNumber.replace(/[^A-Za-z0-9_-]/g, '_')}/${crypto.randomUUID()}${ext ? '.' + ext : ''}`;
    await c.env.CHAT_FILES.put(key, await file.arrayBuffer(), {
      metadata: { name: file.name, type: mime, so: soNumber },
    });
    const { prisma } = deps();
    const row = await prisma.soAttachment.create({
      data: {
        id: crypto.randomUUID(),
        soNumber,
        kind,
        fileName: file.name.slice(0, 200),
        mime,
        size: file.size,
        kvKey: key,
        uploadedBy: String(actor).slice(0, 200),
        createdAt: new Date(),
      },
    });
    try { await cacheDel(CRM_DATA_CACHE_KEY); } catch { /* best-effort */ }
    broadcastLive(c, LiveEvent.Crm, { soNumber, attachmentsChanged: true });
    return c.json({ ok: true, attachment: toJson(row) }, 201);
  });

  // List attachments for one SO — any approved member.
  app.get('/api/crm/attachments', async (c) => {
    const me = await getMe(authStore(c), c.req.header('cookie') ?? null);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    if (!isApproved(me)) return c.json({ error: 'Approval required' }, 403);
    const so = String(c.req.query('so') || '').trim();
    if (!so) return c.json({ error: 'so query required' }, 400);
    const { prisma } = deps();
    const rows = await prisma.soAttachment.findMany({
      where: { soNumber: so },
      orderBy: { createdAt: 'desc' },
    }).catch(() => []);
    return c.json({ attachments: ((rows as any[]) ?? []).map(toJson) });
  });

  // Serve file bytes by attachment id (never exposes raw KV keys).
  // Images + PDFs render inline (native big-view); anything else downloads.
  app.get('/api/crm/files/:id', async (c) => {
    const me = await getMe(authStore(c), c.req.header('cookie') ?? null);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    if (!isApproved(me)) return c.json({ error: 'Approval required' }, 403);
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    const { prisma } = deps();
    const row: any = await prisma.soAttachment.findUnique({ where: { id: c.req.param('id') ?? '' } }).catch(() => null);
    if (!row?.kvKey) return c.json({ error: 'Attachment not found' }, 404);
    const obj = await c.env.CHAT_FILES.getWithMetadata(String(row.kvKey), 'arrayBuffer');
    if (obj.value === null) return c.json({ error: 'File not found' }, 404);
    const meta = (obj.metadata || {}) as { name?: string; type?: string };
    const type = String(row.mime || meta.type || 'application/octet-stream');
    const name = String(row.fileName || meta.name || 'file');
    const headers = new Headers();
    headers.set('Content-Type', type);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    if (!/^image\/|^application\/pdf$/.test(type)) {
      headers.set('Content-Disposition', `attachment; filename="${name.replace(/["\\]/g, '')}"`);
    }
    return new Response(obj.value, { headers });
  });

  // Delete attachment (row + bytes) — MIS only.
  app.delete('/api/crm/attachments/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const { prisma } = deps();
    const row: any = await prisma.soAttachment.findUnique({ where: { id: c.req.param('id') ?? '' } }).catch(() => null);
    if (!row) return c.json({ error: 'Attachment not found' }, 404);
    try {
      if (c.env.CHAT_FILES && row.kvKey) await c.env.CHAT_FILES.delete(String(row.kvKey));
    } catch { /* bytes best-effort — row delete still proceeds */ }
    await prisma.soAttachment.delete({ where: { id: String(row.id) } }).catch(() => {});
    try { await cacheDel(CRM_DATA_CACHE_KEY); } catch { /* best-effort */ }
    notifyLive(c, { type: LiveEvent.Crm, soNumber: String(row.soNumber || ''), attachmentsChanged: true });
    return c.json({ ok: true });
  });
}
