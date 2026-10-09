// ─────────────────────────────────────────────────────────────────────────────
// routes/enquiry-files.ts — enquiry item media uploads (photo bytes locker).
//
// WHY: item photos used to ride inside every PATCH as embedded data-URIs
// (~200-500KB each), so each remark/delete/toggle re-uploaded megabytes and
// D1 rewrote the whole items JSON — saves felt stuck and sometimes failed
// silently. New photos now upload ONCE here and items carry short
// `/api/enquiries/files/<key>` URLs; every later save ships small JSON.
//
// STORAGE IS D1 (EnquiryFile table), NOT Workers KV: in Oct 2026, KV
// accepted worker PUTs (same-request read-back passed) yet every key vanished
// within ~60s while CLI-written keys persisted — silent platform-level loss
// with no error anywhere. D1 reads/writes verify end-to-end via CLI.
// Upload needs any authenticated member (no more privileged than editing
// items); download is by unguessable key (mirrors /api/chat/files/:key, so
// <img> tags and the AI intake fetcher work without session cookies).
// Legacy data-URI media keeps rendering — the read path is unchanged.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import {
  enquiryMe, isApproved,
  type Bindings,
} from '../context';
import {
  MAX_ENQUIRY_FILE_BYTES,
  parseEnquiryFileDataUrl,
  isAllowedEnquiryFileMime,
  isSafeEnquiryFileKey,
  buildEnquiryFileKey,
  storedMimeFor,
  cleanEnquiryFileName,
} from '../../shared/enquiry-files';

function db(c: any): any | null {
  try {
    const d = (c.env as any)?.DB;
    if (!d || typeof d.prepare !== 'function') return null;
    return d;
  } catch { return null; }
}

export function registerEnquiryFileRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // Upload: JSON { name, type, dataUrl } — the frontend already downscales to
  // a data-URI (imageFiles.ts), so no multipart parsing and no new runtime
  // deps; the SAME protocol serves the Express mirror.
  app.post('/api/enquiries/files', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    if (!isApproved(me)) return c.json({ error: 'Approval required' }, 403);
    const database = db(c);
    if (!database) return c.json({ error: 'File storage is not configured' }, 501);
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Expected JSON { name, type, dataUrl }' }, 400);
    }
    const parsed = parseEnquiryFileDataUrl(body?.dataUrl);
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    const mime = parsed.mime;
    if (!isAllowedEnquiryFileMime(mime)) return c.json({ error: 'Only image, video and PDF uploads are allowed' }, 400);
    let bytes: Uint8Array;
    try {
      const bin = atob(parsed.b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      return c.json({ error: 'Undecodable base64 payload' }, 400);
    }
    if (bytes.length === 0) return c.json({ error: 'Empty file' }, 400);
    if (bytes.length > MAX_ENQUIRY_FILE_BYTES) return c.json({ error: 'File too large (max 10MB)' }, 413);
    const name = cleanEnquiryFileName(body?.name);
    const key = buildEnquiryFileKey(name, crypto.randomUUID());
    const storedMime = storedMimeFor(mime, body?.type);
    const nowIso = new Date().toISOString();
    try {
      await database.prepare(
        `INSERT INTO EnquiryFile(key, mime, name, size, data, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
      ).bind(key, storedMime, name, bytes.length, bytes, nowIso).run();
    } catch (e: any) {
      console.error(`[enquiry-files] D1 insert failed for ${key}: ${String(e?.message ?? e).slice(0, 200)}`);
      return c.json({ error: 'File storage write failed — retry (your photo was NOT lost, nothing was saved)' }, 500);
    }
    // Read-back gate: a 201 MUST mean the bytes are servable. If the write
    // didn't persist, fail loudly so the frontend keeps the inline data-URI
    // instead of storing a dead locker URL.
    try {
      const check: any = await database.prepare(`SELECT length(data) AS n FROM EnquiryFile WHERE key = ?`).bind(key).first();
      const n = Number(check?.n ?? -1);
      if (n !== bytes.length) {
        console.error(`[enquiry-files] read-back mismatch for ${key}: wrote ${bytes.length}B, read ${n}`);
        try { await database.prepare(`DELETE FROM EnquiryFile WHERE key = ?`).bind(key).run(); } catch { /* best-effort */ }
        return c.json({ error: 'File storage verification failed — retry (your photo was NOT lost, nothing was saved)' }, 500);
      }
    } catch (e: any) {
      console.error(`[enquiry-files] read-back failed for ${key}: ${String(e?.message ?? e).slice(0, 200)}`);
      return c.json({ error: 'File storage verification failed — retry (your photo was NOT lost, nothing was saved)' }, 500);
    }
    // Success audit: proves put+read-back server-side in tail.
    console.log(`[enquiry-files] stored ${key} (${bytes.length}B ${storedMime}, read-back ok)`);
    return c.json({ key, name, size: bytes.length, type: storedMime, url: `/api/enquiries/files/${key}` }, 201);
  });

  // Serve bytes by key. Keys are `enq/<uuid>.<ext>` (TWO segments) so the
  // route matches both — a single `:key` param never matched and 404'd every
  // photo (Oct 2026 outage). No auth: keys are unguessable, and the key IS
  // the id (mirrors /api/chat/files/:key, so <img> tags and the AI intake
  // fetcher work without session cookies).
  app.get('/api/enquiries/files/enq/:name', async (c) => {
    const database = db(c);
    if (!database) return c.json({ error: 'File storage is not configured' }, 501);
    const key = `enq/${c.req.param('name') ?? ''}`;
    if (!isSafeEnquiryFileKey(key)) return c.json({ error: 'File not found' }, 404);
    let row: any = null;
    try {
      row = await database.prepare(`SELECT mime, name, data FROM EnquiryFile WHERE key = ?`).bind(key).first();
    } catch { /* fall through to 404 */ }
    if (!row?.data) return c.json({ error: 'File not found' }, 404);
    const type = String((row as any)?.mime || 'application/octet-stream');
    const name = String((row as any)?.name || key);
    const headers = new Headers();
    headers.set('Content-Type', type);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    const inline = /^image\/|^video\/|^audio\/|^text\/|^application\/pdf$/.test(type);
    if (!inline) headers.set('Content-Disposition', `attachment; filename="${name.replace(/["\\]/g, '')}"`);
    const data = (row as any).data;
    const buf: ArrayBuffer = data instanceof ArrayBuffer ? data : new Uint8Array(data as any).buffer as ArrayBuffer;
    return new Response(buf, { headers });
  });

}
