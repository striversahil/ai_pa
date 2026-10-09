// shared/enquiry-files.ts — single source of truth for the enquiry item-media
// locker protocol (mirrors worker/routes/enquiry-files.ts).
//
// Uploads arrive as JSON { name, type, dataUrl } (the frontend downscales to
// a data-URI first, so no multipart parsing); items store short
// `/api/enquiries/files/<key>` URLs where key is ALWAYS `enq/<uuid>.<ext>`
// (TWO path segments — the download routes must match both; a single-segment
// `:key` route 404'd every photo in Oct 2026). Storage differs per runtime
// (Worker: D1 EnquiryFile table; Express: local disk) but every validation
// rule lives HERE so the twins can't drift again.
// Framework-free: no Node APIs, no Hono — safe for the Worker bundle.
export const MAX_ENQUIRY_FILE_BYTES = 10 * 1024 * 1024;

const DATAURL_RE = /^data:([a-zA-Z0-9][a-zA-Z0-9/+.=-]*);base64,([A-Za-z0-9+/=]+)$/;

/** Split a `data:<mime>;base64,<payload>` URI into mime + raw base64. */
export function parseEnquiryFileDataUrl(dataUrl: unknown): { mime: string; b64: string } | { error: string } {
  const m = DATAURL_RE.exec(String((dataUrl as any) ?? ''));
  if (!m) return { error: 'dataUrl must be a base64 data-URI' };
  return { mime: m[1].toLowerCase(), b64: m[2] };
}

export function isAllowedEnquiryFileMime(mime: string): boolean {
  return mime.startsWith('image/') || mime.startsWith('video/') || mime === 'application/pdf';
}

/** Locker keys are `enq/<uuid>.<ext>` — opaque, unguessable, slash-free past `enq/`. */
export function isSafeEnquiryFileKey(key: string): boolean {
  return /^enq\/[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/.test(key);
}

/** Mint a locker key from the original filename + a caller-supplied uuid
 *  (uuid source differs per runtime: Worker `crypto.randomUUID()`,
 *  Express `node:crypto` — kept out of this module on purpose). */
export function buildEnquiryFileKey(name: unknown, uid: string): string {
  const ext = (String(name ?? 'file').split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  return `enq/${uid}${ext ? '.' + ext : ''}`;
}

/** Trust the client-declared type only when it agrees with the sniffed data-URI mime family. */
export function storedMimeFor(mime: string, declared: unknown): string {
  const d = String(declared ?? '');
  return d && d.startsWith(mime.split('/')[0]) ? d : mime;
}

export function cleanEnquiryFileName(name: unknown): string {
  return String(name ?? 'file').slice(0, 200);
}
