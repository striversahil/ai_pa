// ─────────────────────────────────────────────────────────────────────────────
// routes/digital-marketing.ts — Digital Marketing automation API (roster + templates + logging).
// Mirror: founder-os_backend/src/routes/digital-marketing.ts (Express alt runtime).
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, requireAdminScope, adminScopeError, notifyLive, LiveEvent, MAX_ATTACHMENT_BYTES, type Bindings } from '../context';
import {
  listDigitalMarketingManagers, createDigitalMarketingManager, updateDigitalMarketingManager,
  listTemplates, createTemplate, updateTemplate, logTask, getDigitalMarketingExport,
  getDigitalMarketingMetricsSeries,
  createAttachmentRecord, getAttachment, deleteAttachmentRecord, toAttachmentJson,
  resolveSelfDigitalMarketingManager,
} from '../../automations/digital-marketing/service';
import { getDigitalMarketingAds, createAd, updateAd, deleteAd, createAdAttachment, getAdAttachment, deleteAdAttachment, toAdAttachmentJson } from '../../automations/digital-marketing/ads';
import { getDigitalMarketingOpenTasks, getOpenTaskById, createOpenTask, updateOpenTask, deleteOpenTask, upsertOpenTaskEntry, ensureEntryForDate, createOpenTaskAttachment, getOpenTaskAttachment, deleteOpenTaskAttachment, toOpenTaskAttachmentJson } from '../../automations/digital-marketing/open-tasks';
import { getViewerMe } from '../viewer';
import { readBody } from '../http';

async function actorName(c: any): Promise<string | null> {
  try {
    const me = await getViewerMe(c);
    return me?.user?.name ?? me?.user?.email ?? null;
  } catch { return null; }
}

export function registerDigitalMarketingRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Roster (root-only, like /api/telecallers: reads and writes) ──────────
  // The dashboard gets the names it needs via data().roster (no emails).
  app.get('/api/digital-marketing/roster', async (c) => {
    try { await requireAdminScope(c); } catch (e) { return adminScopeError(c, e); }
    const { prisma } = deps();
    void prisma;
    const rows = await listDigitalMarketingManagers(c.req.query('deleted') === '1');
    return c.json({ accountants: rows });
  });

  app.post('/api/digital-marketing/roster', async (c) => {
    try { await requireAdminScope(c); } catch (e) { return adminScopeError(c, e); }
    const body = await readBody(c);
    try {
      const row = await createDigitalMarketingManager(body || {});
      notifyLive(c, { type: LiveEvent.DigitalMarketing });
      return c.json(row, 201);
    } catch (e: any) { return c.json({ error: e?.message ?? 'create failed' }, 400); }
  });

  app.put('/api/digital-marketing/roster/:id', async (c) => {
    try { await requireAdminScope(c); } catch (e) { return adminScopeError(c, e); }
    const body = await readBody(c);
    try {
      const row = await updateDigitalMarketingManager(c.req.param('id'), body || {});
      notifyLive(c, { type: LiveEvent.DigitalMarketing });
      return c.json(row);
    } catch (e: any) { return c.json({ error: e?.message ?? 'update failed' }, 400); }
  });

  app.delete('/api/digital-marketing/roster/:id', async (c) => {
    try { await requireAdminScope(c); } catch (e) { return adminScopeError(c, e); }
    await updateDigitalMarketingManager(c.req.param('id'), { deleted: true });
    notifyLive(c, { type: LiveEvent.DigitalMarketing });
    return c.json({ ok: true });
  });

  // ── Templates (root-only reads/writes; dashboard reads via data()) ──────
  app.get('/api/digital-marketing/templates', async (c) => {
    try { await requireAdminScope(c); } catch (e) { return adminScopeError(c, e); }
    const rows = await listTemplates(c.req.query('all') === '1');
    return c.json({ templates: rows });
  });

  app.post('/api/digital-marketing/templates', async (c) => {
    try { await requireAdminScope(c); } catch (e) { return adminScopeError(c, e); }
    const body = await readBody(c);
    try {
      const row = await createTemplate(body || {});
      notifyLive(c, { type: LiveEvent.DigitalMarketing });
      return c.json(row, 201);
    } catch (e: any) { return c.json({ error: e?.message ?? 'create failed' }, 400); }
  });

  app.put('/api/digital-marketing/templates/:id', async (c) => {
    try { await requireAdminScope(c); } catch (e) { return adminScopeError(c, e); }
    const body = await readBody(c);
    try {
      const row = await updateTemplate(c.req.param('id'), body || {});
      notifyLive(c, { type: LiveEvent.DigitalMarketing });
      return c.json(row);
    } catch (e: any) { return c.json({ error: e?.message ?? 'update failed' }, 400); }
  });

  app.delete('/api/digital-marketing/templates/:id', async (c) => {
    try { await requireAdminScope(c); } catch (e) { return adminScopeError(c, e); }
    await updateTemplate(c.req.param('id'), { active: false });
    notifyLive(c, { type: LiveEvent.DigitalMarketing });
    return c.json({ ok: true });
  });

  // ── Root export: past-N-days full ledger (pending/inprogress/done + remarks + file links) ──
  app.get('/api/digital-marketing/export', async (c) => {
    try { await requireAdminScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const origin = new URL(c.req.url).origin;
      return c.json(await getDigitalMarketingExport(c.req.query('days'), origin));
    } catch (e: any) { return c.json({ error: e?.message ?? 'export failed' }, 400); }
  });

  // ── KRA/KPI metrics series: per-day leads/volumes for the dashboard charts ──
  // Aggregates only (no PII) — any signed-in viewer, like the taskbar PATCH.
  // KV-cached under the dashboard prefix, so log writes bust it via the
  // existing invalidator.
  app.get('/api/digital-marketing/metrics-series', async (c) => {
    try {
      return c.json(await getDigitalMarketingMetricsSeries(c.req.query('days')));
    } catch (e: any) { return c.json({ error: e?.message ?? 'series failed' }, 400); }
  });

  // ── ADS registry: manual ad runs (migration 0113) ──
  // Any signed-in viewer can list; writes stamped with the session identity.
  // KV-cached; every write busts it via invalidateDigitalMarketingCache().
  app.get('/api/digital-marketing/ads', async (c) => {
    try {
      return c.json(await getDigitalMarketingAds());
    } catch (e: any) { return c.json({ error: e?.message ?? 'ads failed' }, 400); }
  });

  app.post('/api/digital-marketing/ads', async (c) => {
    const body = await readBody(c);
    try {
      const actor = await actorName(c);
      const row = await createAd(body || {}, actor);
      notifyLive(c, { type: LiveEvent.DigitalMarketing });
      return c.json(row, 201);
    } catch (e: any) { return c.json({ error: e?.message ?? 'create failed' }, 400); }
  });

  app.patch('/api/digital-marketing/ads/:id', async (c) => {
    const body = await readBody(c);
    try {
      const row = await updateAd(c.req.param('id'), body || {});
      notifyLive(c, { type: LiveEvent.DigitalMarketing });
      return c.json(row);
    } catch (e: any) { return c.json({ error: e?.message ?? 'update failed' }, 400); }
  });

  app.delete('/api/digital-marketing/ads/:id', async (c) => {
    try { await requireAdminScope(c); } catch (e) { return adminScopeError(c, e); }
    try {
      const row: any = await deleteAd(c.req.param('id'));
      try {
        if (c.env.CHAT_FILES) {
          const files: any[] = Array.isArray((row as any)?.attachments) ? (row as any).attachments : [];
          for (const f of files) {
            try { if ((f as any)?.kvKey) await c.env.CHAT_FILES.delete(String((f as any).kvKey)); } catch { /* best-effort */ }
          }
        }
      } catch { /* bytes best-effort */ }
      notifyLive(c, { type: LiveEvent.DigitalMarketing });
      return c.json({ ok: true });
    } catch (e: any) { return c.json({ error: e?.message ?? 'delete failed' }, 400); }
  });

  app.post('/api/digital-marketing/ads/:id/files', async (c) => {
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
    if (!isDigitalMarketingMime(mime)) return c.json({ error: 'Only PDF, image, spreadsheet, CSV, text or ZIP files can be attached' }, 400);
    if (file.size > MAX_ATTACHMENT_BYTES) return c.json({ error: 'File too large (max 20MB)' }, 413);
    if (file.size <= 0) return c.json({ error: 'Empty file' }, 400);
    const actor = await actorName(c);
    const adId = c.req.param('id');
    const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const key = `dmads/${String(adId).replace(/[^A-Za-z0-9_-]/g, '_')}/${crypto.randomUUID()}${ext ? '.' + ext : ''}`;
    await c.env.CHAT_FILES.put(key, await file.arrayBuffer(), {
      metadata: { name: file.name, type: mime, ad: adId },
    });
    try {
      const row = await createAdAttachment({
        adId, fileName: file.name.slice(0, 200), mime, size: file.size, kvKey: key, uploadedBy: actor,
      });
      notifyLive(c, { type: LiveEvent.DigitalMarketing });
      return c.json({ ok: true, attachment: toAdAttachmentJson(row) }, 201);
    } catch (e: any) {
      try { await c.env.CHAT_FILES.delete(key); } catch { /* orphan bytes best-effort */ }
      return c.json({ error: e?.message ?? 'attach failed' }, 400);
    }
  });

  app.get('/api/digital-marketing/ads/files/:id', async (c) => {
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    const row: any = await getAdAttachment(c.req.param('id') ?? '').catch(() => null);
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

  app.delete('/api/digital-marketing/ads/files/:id', async (c) => {
    const row: any = await getAdAttachment(c.req.param('id') ?? '').catch(() => null);
    if (!row) return c.json({ error: 'Attachment not found' }, 404);
    const actor = await actorName(c);
    let isRoot = false;
    try { await requireAdminScope(c); isRoot = true; } catch { /* fall through */ }
    if (!isRoot && actor && String(row.uploadedBy) !== String(actor)) {
      return c.json({ error: 'Only the uploader or root can remove this file' }, 403);
    }
    try {
      if (c.env.CHAT_FILES && row.kvKey) await c.env.CHAT_FILES.delete(String(row.kvKey));
    } catch { /* bytes best-effort — row delete still proceeds */ }
    await deleteAdAttachment(String(row.id)).catch(() => {});
    notifyLive(c, { type: LiveEvent.DigitalMarketing });
    return c.json({ ok: true });
  });

  // ── Open Tasks: free-form tasks with start/end + per-day progress (migration 0120) ──
  // Status is a manual open|done tick (dates display-only). Create/update/entry
  // writes are any signed-in viewer (DMM included); DELETE is creator-or-root.
  app.get('/api/digital-marketing/open-tasks', async (c) => {
    try {
      return c.json(await getDigitalMarketingOpenTasks());
    } catch (e: any) { return c.json({ error: e?.message ?? 'open tasks failed' }, 400); }
  });

  app.post('/api/digital-marketing/open-tasks', async (c) => {
    const body = await readBody(c);
    try {
      const actor = await actorName(c);
      const row = await createOpenTask(body || {}, actor);
      notifyLive(c, { type: LiveEvent.DigitalMarketing });
      return c.json(row, 201);
    } catch (e: any) { return c.json({ error: e?.message ?? 'create failed' }, 400); }
  });

  app.patch('/api/digital-marketing/open-tasks/:id', async (c) => {
    const body = await readBody(c);
    try {
      const row = await updateOpenTask(c.req.param('id'), body || {});
      notifyLive(c, { type: LiveEvent.DigitalMarketing });
      return c.json(row);
    } catch (e: any) { return c.json({ error: e?.message ?? 'update failed' }, 400); }
  });

  app.delete('/api/digital-marketing/open-tasks/:id', async (c) => {
    const actor = await actorName(c);
    let isRoot = false;
    try { await requireAdminScope(c); isRoot = true; } catch { /* fall through */ }
    try {
      const task: any = await getOpenTaskById(c.req.param('id')).catch(() => null);
      if (!task) return c.json({ error: 'Task not found' }, 404);
      if (!isRoot && !(actor && String((task as any)?.createdBy ?? '') === String(actor))) {
        return c.json({ error: 'Only the creator or root can delete this task' }, 403);
      }
      const row: any = await deleteOpenTask(c.req.param('id'));
      try {
        if (c.env.CHAT_FILES) {
          const files: any[] = Array.isArray((row as any)?.attachments) ? (row as any).attachments : [];
          for (const f of files) {
            try { if ((f as any)?.kvKey) await c.env.CHAT_FILES.delete(String((f as any).kvKey)); } catch { /* best-effort */ }
          }
        }
      } catch { /* bytes best-effort */ }
      notifyLive(c, { type: LiveEvent.DigitalMarketing });
      return c.json({ ok: true });
    } catch (e: any) { return c.json({ error: e?.message ?? 'delete failed' }, 400); }
  });

  app.put('/api/digital-marketing/open-tasks/:id/entries', async (c) => {
    const body = await readBody(c);
    try {
      const actor = await actorName(c);
      const row = await upsertOpenTaskEntry(c.req.param('id'), String((body as any)?.date ?? ''), (body as any)?.note ?? '', actor);
      notifyLive(c, { type: LiveEvent.DigitalMarketing });
      return c.json(row);
    } catch (e: any) { return c.json({ error: e?.message ?? 'save failed' }, 400); }
  });

  async function uploadOpenTaskFile(c: any, entryDate: string | null) {
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
    if (!isDigitalMarketingMime(mime)) return c.json({ error: 'Only PDF, image, spreadsheet, CSV, text or ZIP files can be attached' }, 400);
    if (file.size > MAX_ATTACHMENT_BYTES) return c.json({ error: 'File too large (max 20MB)' }, 413);
    if (file.size <= 0) return c.json({ error: 'Empty file' }, 400);
    const actor = await actorName(c);
    const taskId = c.req.param('id');
    let entryId: string | null = null;
    if (entryDate !== null) {
      try {
        const entry: any = await ensureEntryForDate(taskId, entryDate, actor);
        entryId = String(entry.id);
      } catch (e: any) {
        return c.json({ error: e?.message ?? 'entry failed' }, 400);
      }
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const key = `dmopen/${String(taskId).replace(/[^A-Za-z0-9_-]/g, '_')}/${crypto.randomUUID()}${ext ? '.' + ext : ''}`;
    await c.env.CHAT_FILES.put(key, await file.arrayBuffer(), {
      metadata: { name: file.name, type: mime, task: taskId },
    });
    try {
      const row = await createOpenTaskAttachment({
        taskId, entryId, fileName: file.name.slice(0, 200), mime, size: file.size, kvKey: key, uploadedBy: actor,
      });
      notifyLive(c, { type: LiveEvent.DigitalMarketing });
      return c.json({ ok: true, attachment: toOpenTaskAttachmentJson(row) }, 201);
    } catch (e: any) {
      try { await c.env.CHAT_FILES.delete(key); } catch { /* orphan bytes best-effort */ }
      return c.json({ error: e?.message ?? 'attach failed' }, 400);
    }
  }

  // Task-level files (entryId NULL).
  app.post('/api/digital-marketing/open-tasks/:id/files', async (c) => {
    return uploadOpenTaskFile(c, null);
  });

  // Daily proof files for one date (auto-creates the day entry).
  app.post('/api/digital-marketing/open-tasks/:id/entries/:date/files', async (c) => {
    return uploadOpenTaskFile(c, String(c.req.param('date') ?? ''));
  });

  app.get('/api/digital-marketing/open-tasks/files/:id', async (c) => {
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    const row: any = await getOpenTaskAttachment(c.req.param('id') ?? '').catch(() => null);
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

  app.delete('/api/digital-marketing/open-tasks/files/:id', async (c) => {
    const row: any = await getOpenTaskAttachment(c.req.param('id') ?? '').catch(() => null);
    if (!row) return c.json({ error: 'Attachment not found' }, 404);
    const actor = await actorName(c);
    let isRoot = false;
    try { await requireAdminScope(c); isRoot = true; } catch { /* fall through */ }
    if (!isRoot && actor && String(row.uploadedBy) !== String(actor)) {
      return c.json({ error: 'Only the uploader or root can remove this file' }, 403);
    }
    try {
      if (c.env.CHAT_FILES && row.kvKey) await c.env.CHAT_FILES.delete(String(row.kvKey));
    } catch { /* bytes best-effort — row delete still proceeds */ }
    await deleteOpenTaskAttachment(String(row.id)).catch(() => {});
    notifyLive(c, { type: LiveEvent.DigitalMarketing });
    return c.json({ ok: true });
  });

  // ── Taskbar logging (any signed-in accounts viewer) ──
  // Who is inferred server-side (session → roster, declared `as` first) —
  // the client never declares attribution.
  app.patch('/api/digital-marketing/logs/:id', async (c) => {
    const body = await readBody(c);
    try {
      const me = await getViewerMe(c).catch(() => null);
      const self = await resolveSelfDigitalMarketingManager(
        (body as any)?.as ?? c.req.query('as') ?? null, me as any,
      ).catch(() => null);
      const row = await logTask(
        c.req.param('id'), body || {},
        (me as any)?.user?.name ?? (me as any)?.user?.email ?? null,
        self ? { selfId: self.selfId, selfName: self.selfName } : null,
      );
      notifyLive(c, { type: LiveEvent.DigitalMarketing });
      return c.json(row);
    } catch (e: any) { return c.json({ error: e?.message ?? 'log failed' }, 400); }
  });

  // ── Proof attachments (bytes in CHAT_FILES KV; any signed-in viewer) ──
  app.post('/api/digital-marketing/logs/:id/files', async (c) => {
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
    if (!isDigitalMarketingMime(mime)) return c.json({ error: 'Only PDF, image, spreadsheet, CSV, text or ZIP files can be attached' }, 400);
    if (file.size > MAX_ATTACHMENT_BYTES) return c.json({ error: 'File too large (max 20MB)' }, 413);
    if (file.size <= 0) return c.json({ error: 'Empty file' }, 400);
    const actor = await actorName(c);
    const logId = c.req.param('id');
    const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const key = `dmm/${String(logId).replace(/[^A-Za-z0-9_-]/g, '_')}/${crypto.randomUUID()}${ext ? '.' + ext : ''}`;
    await c.env.CHAT_FILES.put(key, await file.arrayBuffer(), {
      metadata: { name: file.name, type: mime, log: logId },
    });
    try {
      const row = await createAttachmentRecord({
        logId, fileName: file.name.slice(0, 200), mime, size: file.size, kvKey: key, uploadedBy: actor,
      });
      notifyLive(c, { type: LiveEvent.DigitalMarketing });
      return c.json({ ok: true, attachment: toAttachmentJson(row) }, 201);
    } catch (e: any) {
      try { await c.env.CHAT_FILES.delete(key); } catch { /* orphan bytes best-effort */ }
      return c.json({ error: e?.message ?? 'attach failed' }, 400);
    }
  });

  // Serve file bytes by attachment id (never exposes raw KV keys).
  app.get('/api/digital-marketing/files/:id', async (c) => {
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
  app.delete('/api/digital-marketing/files/:id', async (c) => {
    const row: any = await getAttachment(c.req.param('id') ?? '').catch(() => null);
    if (!row) return c.json({ error: 'Attachment not found' }, 404);
    const actor = await actorName(c);
    let isRoot = false;
    try { await requireAdminScope(c); isRoot = true; } catch { /* fall through */ }
    if (!isRoot && actor && String(row.uploadedBy) !== String(actor)) {
      return c.json({ error: 'Only the uploader or root can remove this file' }, 403);
    }
    try {
      if (c.env.CHAT_FILES && row.kvKey) await c.env.CHAT_FILES.delete(String(row.kvKey));
    } catch { /* bytes best-effort — row delete still proceeds */ }
    await deleteAttachmentRecord(String(row.id)).catch(() => {});
    notifyLive(c, { type: LiveEvent.DigitalMarketing });
    return c.json({ ok: true });
  });
}

function isDigitalMarketingMime(mime: string): boolean {
  return mime === 'application/pdf'
    || mime.startsWith('image/')
    || mime.startsWith('text/')
    || mime === 'text/csv'
    || mime === 'application/zip'
    || mime === 'application/vnd.ms-excel'
    || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}
