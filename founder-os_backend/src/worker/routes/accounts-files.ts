// ─────────────────────────────────────────────────────────────────────────────
// routes/accounts-files.ts — proof-file bytes for accounts task logs.
//
// Split out of routes/accounts.ts (which crossed the 400-line budget when task
// threads landed) on the same pattern as routes/crm-attachments.ts. Behaviour is
// unchanged: bytes in CHAT_FILES KV, metadata row in AccountsTaskAttachment, the
// raw KV key is never exposed to the browser.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, adminGuard, notifyLive, LiveEvent, MAX_ATTACHMENT_BYTES, type Bindings } from '../context';
import {
  createAttachmentRecord, getAttachment, deleteAttachmentRecord, toAttachmentJson,
} from '../../automations/accounts/service';
import { getViewerMe } from '../viewer';
import { writeError } from '../http';

async function actorName(c: any): Promise<string | null> {
  try {
    const me = await getViewerMe(c);
    return me?.user?.name ?? me?.user?.email ?? null;
  } catch { return null; }
}

function isAccountsMime(mime: string): boolean {
  return mime === 'application/pdf'
    || mime.startsWith('image/')
    || mime.startsWith('text/')
    || mime === 'text/csv'
    || mime === 'application/zip'
    || mime === 'application/vnd.ms-excel'
    || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

export function registerAccountsFileRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // Upload proof for a task log (or a payment cycle's receipt).
  app.post('/api/accounts/logs/:id/files', async (c) => {
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: 'Expected multipart/form-data' }, 400);
    }
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'file field required' }, 400);
    const mime = file.type || 'application/octet-stream';
    if (!isAccountsMime(mime)) return c.json({ error: 'Only PDF, image, spreadsheet, CSV, text or ZIP files can be attached' }, 400);
    if (file.size > MAX_ATTACHMENT_BYTES) return c.json({ error: 'File too large (max 20MB)' }, 413);
    if (file.size <= 0) return c.json({ error: 'Empty file' }, 400);
    const actor = await actorName(c);
    const logId = c.req.param('id');
    const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const key = `acct/${String(logId).replace(/[^A-Za-z0-9_-]/g, '_')}/${crypto.randomUUID()}${ext ? '.' + ext : ''}`;
    await c.env.CHAT_FILES.put(key, await file.arrayBuffer(), {
      metadata: { name: file.name, type: mime, log: logId },
    });
    try {
      const row = await createAttachmentRecord({
        logId, fileName: file.name.slice(0, 200), mime, size: file.size, kvKey: key, uploadedBy: actor,
      });
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json({ ok: true, attachment: toAttachmentJson(row) }, 201);
    } catch (e: any) {
      try { await c.env.CHAT_FILES.delete(key); } catch { /* orphan bytes best-effort */ }
      return writeError(c, e, 'attach failed');
    }
  });

  // Serve file bytes by attachment id (never exposes raw KV keys).
  app.get('/api/accounts/files/:id', async (c) => {
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    const { prisma } = deps();
    void prisma;
    const row: any = await getAttachment(c.req.param('id') ?? '').catch(() => null);
    if (!row?.kvKey) return c.json({ error: 'Attachment not found' }, 404);
    const obj = await c.env.CHAT_FILES.getWithMetadata(String(row.kvKey), 'arrayBuffer');
    if (obj.value === null) return c.json({ error: 'File not found' }, 404);
    const meta = (obj.metadata || {}) as { name?: string; type?: string };
    const type = String(row.mime || meta.type || 'application/octet-stream');
    const name = String(row.fileName || meta.name || 'file');
    const headers = new Headers();
    headers.set('Content-Type', type);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    if (!/^image\/|^application\/pdf$|^text\//.test(type)) {
      headers.set('Content-Disposition', `attachment; filename="${name.replace(/["\\]/g, '')}"`);
    }
    return new Response(obj.value, { headers });
  });

  // Delete attachment (row + bytes) — uploader or root.
  app.delete('/api/accounts/files/:id', async (c) => {
    const row: any = await getAttachment(c.req.param('id') ?? '').catch(() => null);
    if (!row) return c.json({ error: 'Attachment not found' }, 404);
    const actor = await actorName(c);
    const isRoot = (await adminGuard(c)) === null;
    if (!isRoot && actor && String(row.uploadedBy) !== String(actor)) {
      return c.json({ error: 'Only the uploader or root can remove this file' }, 403);
    }
    try {
      if (c.env.CHAT_FILES && row.kvKey) await c.env.CHAT_FILES.delete(String(row.kvKey));
    } catch { /* bytes best-effort — row delete still proceeds */ }
    await deleteAttachmentRecord(String(row.id)).catch(() => {});
    notifyLive(c, { type: LiveEvent.Accounts });
    return c.json({ ok: true });
  });
}
