// ─────────────────────────────────────────────────────────────────────────────
// routes/accounts.ts — Accounts automation API (roster + templates + logging).
// Mirror: founder-os_backend/src/routes/accounts.ts (Express alt runtime).
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, requireMisScope, misScopeError, notifyLive, LiveEvent, MAX_ATTACHMENT_BYTES, type Bindings } from '../context';
import {
  listAccountants, createAccountant, updateAccountant,
  listTemplates, createTemplate, updateTemplate, logTask, getAccountsExport,
  createAttachmentRecord, getAttachment, deleteAttachmentRecord, toAttachmentJson,
  resolveSelfAccountant, payDue,
} from '../../automations/accounts/service';
import {
  listCashEntries, createCashEntry, updateCashEntry, deleteCashEntry,
} from '../../automations/accounts/cash';
import { getViewerMe } from '../viewer';

async function actorName(c: any): Promise<string | null> {
  try {
    const me = await getViewerMe(c);
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

  // ── Payment dues (Worker-only; Express is frozen — no mirror) ─────────────
  // Founder rule: ANY accountant manages dues (add/edit/remove), not just
  // MIS. Task templates stay MIS-only above; these endpoints force
  // kind='payment' and refuse task rows both ways.
  async function paymentGate(c: any) {
    const me = await getViewerMe(c).catch(() => null);
    if (!me) throw new Error('Authentication required');
    const scopes = ((me as any)?.scopes ?? []) as string[];
    if ((me as any)?.isAdmin || scopes.includes('mis') || scopes.includes('accounts')) return me;
    throw new Error("Requires 'accounts' permission");
  }

  app.post('/api/accounts/payments', async (c) => {
    try { await paymentGate(c); } catch (e: any) {
      const msg = String(e?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await createTemplate({ ...(body || {}), kind: 'payment' });
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row, 201);
    } catch (e: any) { return c.json({ error: e?.message ?? 'create failed' }, 400); }
  });

  app.put('/api/accounts/payments/:id', async (c) => {
    try { await paymentGate(c); } catch (e: any) {
      const msg = String(e?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    const body = await c.req.json().catch(() => ({}));
    try {
      const existing: any = await listTemplates(true).then((ts) => ts.find((t: any) => String(t.id) === c.req.param('id')));
      if (!existing) return c.json({ error: 'payment due not found' }, 404);
      if (String(existing.kind || 'task') !== 'payment') return c.json({ error: 'not a payment due' }, 400);
      if (body && body.kind !== undefined && String(body.kind) !== 'payment') {
        return c.json({ error: 'kind cannot be changed' }, 400);
      }
      const row = await updateTemplate(c.req.param('id'), { ...(body || {}), kind: 'payment' });
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row);
    } catch (e: any) { return c.json({ error: e?.message ?? 'update failed' }, 400); }
  });

  app.delete('/api/accounts/payments/:id', async (c) => {
    try { await paymentGate(c); } catch (e: any) {
      const msg = String((e as any)?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    try {
      const existing: any = await listTemplates(true).then((ts) => ts.find((t: any) => String(t.id) === c.req.param('id')));
      if (!existing) return c.json({ error: 'payment due not found' }, 404);
      if (String(existing.kind || 'task') !== 'payment') return c.json({ error: 'not a payment due' }, 400);
      await updateTemplate(c.req.param('id'), { active: false });
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json({ ok: true });
    } catch (e: any) { return c.json({ error: e?.message ?? 'delete failed' }, 400); }
  });

  // Mark a billing cycle paid (amount + reference). Creates the cycle
  // instance on demand, so projected (future) dues pay in one call.
  // Identity credit mirrors the taskbar log route below.
  app.post('/api/accounts/payments/pay', async (c) => {
    let me: any;
    try { me = await paymentGate(c); } catch (e: any) {
      const msg = String((e as any)?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    const body = await c.req.json().catch(() => ({}));
    try {
      const self = await resolveSelfAccountant(
        (body as any)?.as ?? c.req.query('as') ?? null, me as any,
      ).catch(() => null);
      const row = await payDue(
        String(body?.templateId || ''),
        String(body?.dueDate || '').slice(0, 10),
        { paidAmount: body?.paidAmount, paidRef: body?.paidRef, remark: body?.remark },
        (me as any)?.user?.name ?? (me as any)?.user?.email ?? null,
        self ? { selfId: self.selfId, selfName: self.selfName } : null,
      );
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row);
    } catch (e: any) { return c.json({ error: e?.message ?? 'pay failed' }, 400); }
  });

  // ── Dispatch cash report (Worker-only) ────────────────────────────────
  // Simple in/out ledger. Reads + adds: accounts OR dispatch floor (the floor
  // records its own spends). Edits/deletes: accounts/MIS only, so history
  // can't be rewritten from the floor.
  async function cashReadGate(c: any) {
    const me = await getViewerMe(c).catch(() => null);
    if (!me) throw new Error('Authentication required');
    const scopes = ((me as any)?.scopes ?? []) as string[];
    if ((me as any)?.isAdmin || scopes.includes('mis') || scopes.includes('accounts') || scopes.includes('dispatch')) return me;
    throw new Error("Requires 'accounts' or 'dispatch' permission");
  }
  async function cashWriteGate(c: any) {
    const me = await getViewerMe(c).catch(() => null);
    if (!me) throw new Error('Authentication required');
    const scopes = ((me as any)?.scopes ?? []) as string[];
    if ((me as any)?.isAdmin || scopes.includes('mis') || scopes.includes('accounts')) return me;
    throw new Error("Requires 'accounts' permission");
  }

  app.get('/api/accounts/cash', async (c) => {
    try { await cashReadGate(c); } catch (e: any) {
      const msg = String(e?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    try {
      const { entries, summary } = await listCashEntries(1000);
      return c.json({ entries, summary });
    } catch (e: any) { return c.json({ error: e?.message ?? 'load failed' }, 400); }
  });

  app.post('/api/accounts/cash', async (c) => {
    let me: any;
    try { me = await cashReadGate(c); } catch (e: any) {
      const msg = String(e?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await createCashEntry(body || {}, me?.user?.name ?? me?.user?.email ?? null);
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row, 201);
    } catch (e: any) { return c.json({ error: e?.message ?? 'create failed' }, 400); }
  });

  app.patch('/api/accounts/cash/:id', async (c) => {
    try { await cashWriteGate(c); } catch (e: any) {
      const msg = String(e?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await updateCashEntry(c.req.param('id'), body || {});
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row);
    } catch (e: any) { return c.json({ error: e?.message ?? 'update failed' }, 400); }
  });

  app.delete('/api/accounts/cash/:id', async (c) => {
    try { await cashWriteGate(c); } catch (e: any) {
      const msg = String(e?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    try {
      await deleteCashEntry(c.req.param('id'));
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json({ ok: true });
    } catch (e: any) { return c.json({ error: e?.message ?? 'delete failed' }, 400); }
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
      const me = await getViewerMe(c).catch(() => null);
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
