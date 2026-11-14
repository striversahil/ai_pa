// ─────────────────────────────────────────────────────────────────────────────
// routes/crm-attachments.ts — SO document attachments.
//
// Invoice PDFs, packing photos, LR copies, PODs attached to a sales order from
// the CRM dashboard. Metadata is durable in D1 (SoAttachment, keyed by SO
// number — snapshot refreshes can never wipe it); file bytes live in Workers
// KV (CHAT_FILES, same locker as team-chat files).
//
// Auth (2026-11-04): proof uploads (invoice + packing_before + packing_after)
// are root *or* dispatch floor — the floor must attach the dispatch proof
// itself; LR/POD/other uploads and ALL deletes stay root-only. Listing stays
// gated (SO numbers are guessable). Byte-serving is OPEN (2026-11-06): file
// ids are crypto-random UUIDs (unguessable bearer URLs, same contract as
// /api/chat/files/:key and /api/enquiries/files/*), so View/Download links
// work without a session — e.g. shared with a customer/transporter or opened
// in a context where the login cookie isn't attached.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import {
  authStore, getMe, isApproved, requireAdminScope, requireScope, adminGuard,
  notifyLive, broadcastLive, LiveEvent, MAX_ATTACHMENT_BYTES, deps,
  type Bindings,
} from '../context';

const VALID_KINDS = new Set([
  'invoice', 'packing_before', 'packing_after',
  'transport_receipt', 'courier_receipt', 'packing_list',
  'lr', 'pod', 'other',
]);

/** Kinds the dispatch floor may upload itself (the per-dispatch proof). */
const PROOF_KINDS = new Set([
  'invoice', 'packing_before', 'packing_after',
  'transport_receipt', 'courier_receipt', 'packing_list',
]);

/** The three extra dispatch documents accept a photo OR a PDF — the global
 *  mime allow-list already covers both, so they need no extra check. */

function isAllowedMime(mime: string): boolean {
  return mime === 'application/pdf' || mime.startsWith('image/');
}

import {
  createSoAttachment,
  deleteSoAttachment,
  findSoAttachment,
  listSoAttachments,
  toSoAttachmentJson,
} from '../../modules/crm/attachments';

export function registerCrmAttachmentRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // Upload: root (everything) or the dispatch floor (proof kinds only — invoice
  // + packing photos, so the floor can attach its own dispatch proof).
  app.post('/api/crm/attachments', async (c) => {
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
    if (!VALID_KINDS.has(kind)) return c.json({ error: 'kind must be one of invoice|packing_before|packing_after|transport_receipt|courier_receipt|packing_list|lr|pod|other' }, 400);
    let isRoot = true;
    try {
      await requireAdminScope(c);
    } catch {
      // Not root — the floor may still upload the dispatch proof kinds.
      isRoot = false;
      if (!PROOF_KINDS.has(kind)) {
        return c.json({ error: 'Only root can upload this document kind.' }, 403);
      }
      try {
        await requireScope(authStore(c), c.req.header('cookie') ?? null, 'dispatch');
      } catch {
        return c.json({ error: 'Proof uploads need the dispatch scope (root can upload everything).' }, 403);
      }
    }
    void isRoot;
    if (!(file instanceof File)) return c.json({ error: 'file field required' }, 400);
    const mime = file.type || 'application/octet-stream';
    if (!isAllowedMime(mime)) return c.json({ error: 'Only PDF and image files can be attached' }, 400);
    if (kind === 'invoice' && mime !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      return c.json({ error: 'Invoice proof must be a PDF file.' }, 400);
    }
    if (
      (kind === 'packing_before' || kind === 'packing_after') &&
      !mime.startsWith('image/') &&
      !/\.(png|jpe?g|webp|gif)$/i.test(file.name)
    ) {
      return c.json({ error: 'Packing proof must be a photo (image file).' }, 400);
    }
    if (file.size > MAX_ATTACHMENT_BYTES) return c.json({ error: 'File too large (max 20MB)' }, 413);
    if (file.size <= 0) return c.json({ error: 'Empty file' }, 400);
    const me = await getMe(authStore(c), c.req.header('cookie') ?? null);
    const actor = me?.user?.name || me?.user?.email || 'root';
    const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const key = `so/${soNumber.replace(/[^A-Za-z0-9_-]/g, '_')}/${crypto.randomUUID()}${ext ? '.' + ext : ''}`;
    await c.env.CHAT_FILES.put(key, await file.arrayBuffer(), {
      metadata: { name: file.name, type: mime, so: soNumber },
    });
    const { prisma } = deps();
    const row = await createSoAttachment(prisma, {
      soNumber,
      kind,
      fileName: file.name,
      mime,
      size: file.size,
      kvKey: key,
      uploadedBy: actor,
    });
    broadcastLive(c, LiveEvent.Crm, { soNumber, attachmentsChanged: true });
    return c.json({ ok: true, attachment: toSoAttachmentJson(row) }, 201);
  });

  // List attachments for one SO — any approved member.
  app.get('/api/crm/attachments', async (c) => {
    const me = await getMe(authStore(c), c.req.header('cookie') ?? null);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    if (!isApproved(me)) return c.json({ error: 'Approval required' }, 403);
    const so = String(c.req.query('so') || '').trim();
    if (!so) return c.json({ error: 'so query required' }, 400);
    const { prisma } = deps();
    const rows = await listSoAttachments(prisma, so);
    return c.json({ attachments: ((rows as any[]) ?? []).map(toSoAttachmentJson) });
  });

  // Serve file bytes by attachment id (never exposes raw KV keys).
  // Images + PDFs render inline (native big-view); anything else downloads.
  // No auth (2026-11-06): ids are crypto-random UUIDs — the URL is the bearer
  // token (mirrors /api/chat/files/:key), so proofs are shareable without a
  // session. Listing/upload/delete above stay gated.
  app.get('/api/crm/files/:id', async (c) => {
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    const { prisma } = deps();
    const row: any = await findSoAttachment(prisma, c.req.param('id') ?? '');
    if (!row?.kvKey) return c.json({ error: 'Attachment not found' }, 404);
    const obj = await c.env.CHAT_FILES.getWithMetadata(String(row.kvKey), 'arrayBuffer');
    if (obj.value === null) return c.json({ error: 'File not found' }, 404);
    const meta = (obj.metadata || {}) as { name?: string; type?: string };
    const type = String(row.mime || meta.type || 'application/octet-stream');
    const name = String(row.fileName || meta.name || 'file');
    const headers = new Headers();
    headers.set('Content-Type', type);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    // `?download=1` forces a download (used by the dispatch-proof buttons);
    // otherwise images + PDFs render inline and anything else downloads.
    if (String(c.req.query('download') || '') === '1' || !/^image\/|^application\/pdf$/.test(type)) {
      headers.set('Content-Disposition', `attachment; filename="${name.replace(/["\\]/g, '')}"`);
    }
    return new Response(obj.value, { headers });
  });

  // Delete attachment (row + bytes) — root only.
  app.delete('/api/crm/attachments/:id', async (c) => {
    const denied = await adminGuard(c); if (denied) return denied;
    const { prisma } = deps();
    const row: any = await findSoAttachment(prisma, c.req.param('id') ?? '');
    if (!row) return c.json({ error: 'Attachment not found' }, 404);
    try {
      if (c.env.CHAT_FILES && row.kvKey) await c.env.CHAT_FILES.delete(String(row.kvKey));
    } catch { /* bytes best-effort — row delete still proceeds */ }
    await deleteSoAttachment(prisma, String(row.id));
    notifyLive(c, { type: LiveEvent.Crm, soNumber: String(row.soNumber || ''), attachmentsChanged: true });
    return c.json({ ok: true });
  });
}
