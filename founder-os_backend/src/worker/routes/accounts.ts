// ─────────────────────────────────────────────────────────────────────────────
// routes/accounts.ts — Accounts automation API (roster + templates + logging).
// Mirror: founder-os_backend/src/routes/accounts.ts (Express alt runtime).
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import {
  deps, requireMisScope, misScopeError, notifyLive, LiveEvent,
  authStore, getMe, readSessionCookie, MAX_ATTACHMENT_BYTES, type Bindings,
} from '../context';
import {
  listAccountants, createAccountant, updateAccountant,
  listTemplates, createTemplate, updateTemplate, logTask, getAccountsExport,
  createAttachmentRecord, getAttachment, deleteAttachmentRecord, toAttachmentJson,
  resolveSelfAccountant,
} from '../../automations/accounts/service';

async function actorName(c: any): Promise<string | null> {
  try {
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    return me?.user?.name ?? me?.user?.email ?? null;
  } catch { return null; }
}

export function registerAccountsRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Roster (MIS-only, like /api/telecallers: reads and writes) ──────────
  // The dashboard gets the names it needs via data().roster (no emails).
  app.get('/api/accounts/roster', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const { prisma } = deps();
    void prisma;
    const rows = await listAccountants(c.req.query('deleted') === '1');
    return c.json({ accountants: rows });
  });

  app.post('/api/accounts/roster', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await createAccountant(body || {});
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row, 201);
    } catch (e: any) { return c.json({ error: e?.message ?? 'create failed' }, 400); }
  });

  app.put('/api/accounts/roster/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await updateAccountant(c.req.param('id'), body || {});
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row);
    } catch (e: any) { return c.json({ error: e?.message ?? 'update failed' }, 400); }
  });

  app.delete('/api/accounts/roster/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    await updateAccountant(c.req.param('id'), { deleted: true });
    notifyLive(c, { type: LiveEvent.Accounts });
    return c.json({ ok: true });
  });

  // ── Templates (MIS-only reads/writes; dashboard reads via data()) ──────
  app.get('/api/accounts/templates', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const rows = await listTemplates(c.req.query('all') === '1');
    return c.json({ templates: rows });
  });

  app.post('/api/accounts/templates', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await createTemplate(body || {});
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row, 201);
    } catch (e: any) { return c.json({ error: e?.message ?? 'create failed' }, 400); }
  });

  app.put('/api/accounts/templates/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await updateTemplate(c.req.param('id'), body || {});
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row);
    } catch (e: any) { return c.json({ error: e?.message ?? 'update failed' }, 400); }
  });

  app.delete('/api/accounts/templates/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    await updateTemplate(c.req.param('id'), { active: false });
    notifyLive(c, { type: LiveEvent.Accounts });
    return c.json({ ok: true });
  });

  // ── MIS export: date-range full ledger (pending/inprogress/done + remarks + file links) ──
  app.get('/api/accounts/export', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    try {
      const origin = new URL(c.req.url).origin;
      return c.json(await getAccountsExport(c.req.query('days'), origin, c.req.query('from'), c.req.query('to')));
    } catch (e: any) { return c.json({ error: e?.message ?? 'export failed' }, 400); }
  });

  // ── Taskbar logging (any signed-in accounts viewer; MIS included) ──
  // Who is inferred server-side (session → roster, declared `as` first) —
  // the client never declares attribution.
  app.patch('/api/accounts/logs/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null)).catch(() => null);
      const self = await resolveSelfAccountant(
        (body as any)?.as ?? c.req.query('as') ?? null, me as any,
      ).catch(() => null);
      const row = await logTask(
        c.req.param('id'), body || {},
        (me as any)?.user?.name ?? (me as any)?.user?.email ?? null,
        self ? { selfId: self.selfId, selfName: self.selfName } : null,
      );
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row);
    } catch (e: any) { return c.json({ error: e?.message ?? 'log failed' }, 400); }
  });

  // ── Proof attachments (bytes in CHAT_FILES KV; any signed-in viewer) ──
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
      return c.json({ error: e?.message ?? 'attach failed' }, 400);
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

  // Delete attachment (row + bytes) — uploader, MIS, or root.
  app.delete('/api/accounts/files/:id', async (c) => {
    const row: any = await getAttachment(c.req.param('id') ?? '').catch(() => null);
    if (!row) return c.json({ error: 'Attachment not found' }, 404);
    const actor = await actorName(c);
    let isMis = false;
    try { await requireMisScope(c); isMis = true; } catch { /* fall through */ }
    if (!isMis && actor && String(row.uploadedBy) !== String(actor)) {
      return c.json({ error: 'Only the uploader or MIS can remove this file' }, 403);
    }
    try {
      if (c.env.CHAT_FILES && row.kvKey) await c.env.CHAT_FILES.delete(String(row.kvKey));
    } catch { /* bytes best-effort — row delete still proceeds */ }
    await deleteAttachmentRecord(String(row.id)).catch(() => {});
    notifyLive(c, { type: LiveEvent.Accounts });
    return c.json({ ok: true });
  });
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
