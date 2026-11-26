// ai-gateway-parts/text.ts — framework-free text/vision helpers used by the
// gateway. Split out of pure.ts to keep that file under the 400-line budget;
// pure.ts re-exports these so existing imports keep working.
import type { MessageContent, ImagePart } from "./types";

/** Extract the first JSON object/array from model prose (fenced block or
 *  balanced-brace scan). Returns null when nothing parses. */
export function extractJson(raw: string): unknown | null {
  const str = String(raw ?? '').trim();
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch { /* fall through */ }
  const fenced = str.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch { /* fall through */ }
  }
  let start = str.indexOf('{');
  if (start === -1) start = str.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(str.slice(start, i + 1));
        } catch { return null; }
      }
    }
  }
  return null;
}

/** Build a vision user message: text + image URLs (data-URI or https).
 *  Images beyond maxImages are dropped (caller should send thumbnails).
 *  Accepts raw URL strings or { url } objects. */
export function buildVisionUserContent(text: string, imageUrls: Array<string | { url?: unknown }>, maxImages = 4): MessageContent {
  const imgs = (Array.isArray(imageUrls) ? imageUrls : [])
    .map((u) => (u != null && typeof u === 'object' ? (u as { url?: unknown }).url : u))
    .map((u) => String(u ?? '').trim())
    .filter((u) => u.length > 0 && (u.startsWith('data:image/') || u.startsWith('http')))
    .slice(0, Math.max(0, maxImages));
  if (imgs.length === 0) return text;
  return [
    { type: 'text', text },
    ...imgs.map((url): ImagePart => ({ type: 'image_url', image_url: { url } })),
  ];
}
