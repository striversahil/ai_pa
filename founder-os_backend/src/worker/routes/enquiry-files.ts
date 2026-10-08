// ─────────────────────────────────────────────────────────────────────────────
// routes/enquiry-files.ts — enquiry item media uploads (photo bytes locker).
//
// WHY: item photos used to ride inside every PATCH as embedded data-URIs
// (~200-500KB each), so each remark/delete/toggle re-uploaded megabytes and
// D1 rewrote the whole items JSON — saves felt stuck and sometimes failed
// silently. New photos now upload ONCE here and items carry short
// `/api/enquiries/files/<key>` URLs; every later save ships small JSON.
// Bytes live in Workers KV (CHAT_FILES, same locker as team-chat + SO files).
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

/** Matches the client downscale cap (imageFiles.ts) — bigger files are rejected. */
const MAX_ENQUIRY_FILE_BYTES = 10 * 1024 * 1024;

function isAllowedMime(mime: string): boolean {
  return mime.startsWith('image/') || mime.startsWith('video/') || mime === 'application/pdf';
}

function keyIsSafe(key: string): boolean {
  return /^enq\/[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/.test(key);
}

export function registerEnquiryFileRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // Upload: JSON { name, type, dataUrl } — the frontend already downscales to
  // a data-URI (imageFiles.ts), so no multipart parsing and no new runtime
  // deps; the SAME protocol serves the Express mirror.
  app.post('/api/enquiries/files', async (c) => {
    const me = await enquiryMe(c);
    if (!me) return c.json({ error: 'Authentication required' }, 401);
    if (!isApproved(me)) return c.json({ error: 'Approval required' }, 403);
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Expected JSON { name, type, dataUrl }' }, 400);
    }
    const dataUrl = String(body?.dataUrl ?? '');
    const m = /^data:([a-zA-Z0-9][a-zA-Z0-9/+.=-]*);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) return c.json({ error: 'dataUrl must be a base64 data-URI' }, 400);
    const mime = m[1].toLowerCase();
    if (!isAllowedMime(mime)) return c.json({ error: 'Only image, video and PDF uploads are allowed' }, 400);
    let bytes: Uint8Array;
    try {
      const bin = atob(m[2]);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      return c.json({ error: 'Undecodable base64 payload' }, 400);
    }
    if (bytes.length === 0) return c.json({ error: 'Empty file' }, 400);
    if (bytes.length > MAX_ENQUIRY_FILE_BYTES) return c.json({ error: 'File too large (max 10MB)' }, 413);
    const name = String(body?.name ?? 'file').slice(0, 200);
    const ext = (name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const key = `enq/${crypto.randomUUID()}${ext ? '.' + ext : ''}`;
    await c.env.CHAT_FILES.put(key, bytes, {
      metadata: { name, type: body?.type && String(body.type).startsWith(mime.split('/')[0]) ? String(body.type) : mime },
    });
    return c.json({ key, name, size: bytes.length, type: mime, url: `/api/enquiries/files/${key}` }, 201);
  });

  // Serve bytes by key (never exposes raw KV keys — the key IS the id).
  app.get('/api/enquiries/files/:key', async (c) => {
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    const key = `enq/${c.req.param('key') ?? ''}`;
    if (!keyIsSafe(key)) return c.json({ error: 'File not found' }, 404);
    const obj = await c.env.CHAT_FILES.getWithMetadata(key, 'arrayBuffer');
    if (obj.value === null) return c.json({ error: 'File not found' }, 404);
    const meta = (obj.metadata || {}) as { name?: string; type?: string };
    const type = meta.type || 'application/octet-stream';
    const name = meta.name || key;
    const headers = new Headers();
    headers.set('Content-Type', type);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    const inline = /^image\/|^video\/|^audio\/|^text\/|^application\/pdf$/.test(type);
    if (!inline) headers.set('Content-Disposition', `attachment; filename="${name.replace(/["\\]/g, '')}"`);
    return new Response(obj.value, { headers });
  });
}
