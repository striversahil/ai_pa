// fetch-page.ts — default `fetch_page` tool for engine copilots.
//
// Turns a URL (usually a top web_search hit) into plain markdown text the LLM
// can process. Edge-safe (fetch only, no Node deps).
//
// Provider chain, first non-empty win:
//   1. Official Firecrawl API (api.firecrawl.dev) when the FIRECRAWL_API_KEY
//      worker secret is set — `printf '%s' "$KEY" | npx wrangler secret put
//      FIRECRAWL_API_KEY` (free tier works).
//   2. Jina AI reader (https://r.jina.ai/<url>) — completely free, no key, no
//      signup. Anonymous fair-use throttling applies; bursts may 429.
// Empty → `{url, text: '', note}` (never throws) so the turn falls back to
// search snippets instead of failing.
//
// NOTE: this is NOT the firecrawl.dev website-to-text demo endpoint — that one
// only answers its own page's short-lived preview token + reCAPTCHA session
// and 401s from any server. Don't "restore" it here.
import type { ToolDefinition } from './ai-gateway';

export const FETCH_PAGE_TOOL = 'fetch_page';

export interface FetchPageOutput {
  url: string;
  title: string;
  text: string;
  provider: string;
  note?: string;
}

export function fetchPageToolDef(): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: FETCH_PAGE_TOOL,
      description: 'Fetch a web page as plain text (markdown) so you can read its actual content — prices, specs, terms. Use on the 1-2 best web_search hits when snippets are not enough. Returns title + truncated text — always cite the source URL when you use it. Never invent page content when text is empty.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full http(s) URL to fetch' },
          maxChars: { type: 'number', description: 'Max text chars, 500-6000 (default 3000)' },
        },
        required: ['url'],
      },
    },
  };
}

const FETCH_TIMEOUT_MS = 10_000;
const MIN_CHARS = 500;
const MAX_CHARS = 6000;
const DEFAULT_CHARS = 3000;

function key(env: Record<string, unknown>, name: string): string {
  return String((env as any)?.[name] ?? '').trim();
}

function cleanUrl(raw: string): string {
  const u = String(raw ?? '').trim().slice(0, 1000);
  if (!/^https?:\/\//i.test(u)) return '';
  try {
    const p = new URL(u);
    if (!/^https?:$/.test(p.protocol)) return '';
    return p.toString().slice(0, 1000);
  } catch {
    return '';
  }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<any | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url: string, headers?: Record<string, string>, timeoutMs = FETCH_TIMEOUT_MS): Promise<{ status: number; text: string } | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ac.signal });
    if (!res.ok) return { status: res.status, text: '' };
    const text = await res.text().catch(() => '');
    return { status: res.status, text };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Official Firecrawl API (keyed). Same markdown output family the demo page uses. */
async function viaFirecrawl(apiKey: string, url: string, maxChars: number): Promise<FetchPageOutput | null> {
  const data = await fetchJson('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ url, formats: ['markdown'] }),
  });
  const md = (data as any)?.data?.markdown ?? (data as any)?.markdown;
  const title = String((data as any)?.data?.metadata?.title ?? (data as any)?.metadata?.title ?? '');
  const text = String(md ?? '').trim();
  if (!text) return null;
  return { url, title: title.slice(0, 200), text: text.slice(0, maxChars), provider: 'firecrawl' };
}

/** Jina AI reader — free, keyless. Prefix any URL, get markdown back. */
async function viaJina(url: string, maxChars: number): Promise<FetchPageOutput | null> {
  const r = await fetchText(`https://r.jina.ai/${url}`, {
    'User-Agent': 'Mozilla/5.0 (compatible; FounderOS/1.0)',
    'x-return-format': 'markdown',
  });
  if (!r || !r.text.trim()) return null;
  const body = r.text;
  const titleM = body.match(/^Title:\s*(.+)$/m);
  const mdIdx = body.indexOf('Markdown Content:');
  const text = (mdIdx >= 0 ? body.slice(mdIdx + 'Markdown Content:'.length) : body).trim();
  if (!text) return null;
  return {
    url,
    title: (titleM ? titleM[1] : '').trim().slice(0, 200),
    text: text.slice(0, maxChars),
    provider: 'jina',
  };
}

export async function execFetchPage(
  env: Record<string, unknown>,
  url: string,
  maxChars?: unknown,
): Promise<FetchPageOutput> {
  const clean = cleanUrl(url);
  if (!clean) return { url: String(url ?? '').slice(0, 200), title: '', text: '', provider: 'none', note: 'invalid URL — must be a full http(s) URL' };
  const n = Math.min(MAX_CHARS, Math.max(MIN_CHARS, Math.floor(Number(maxChars) || DEFAULT_CHARS)));
  const fcKey = key(env, 'FIRECRAWL_API_KEY');
  if (fcKey) {
    const r = await viaFirecrawl(fcKey, clean, n).catch(() => null);
    if (r && r.text) return r;
  }
  const jina = await viaJina(clean, n).catch(() => null);
  if (jina && jina.text) return jina;
  return { url: clean, title: '', text: '', provider: 'none', note: 'page fetch unavailable right now — answer from search snippets or say so' };
}

/** Chime label for the UI (engine uses this directly, not the dept def). */
export function fetchPageActivity(args: Record<string, any>, out: { result: unknown }): string {
  const r = (out.result ?? {}) as FetchPageOutput;
  let host = '';
  try { host = new URL(String((args as any)?.url ?? '')).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  if (!r.text) return `Fetched page${host ? ` · ${host}` : ''} · no text`;
  return `Fetched page${host ? ` · ${host}` : ''} · ${(r.text.length / 1000).toFixed(1)}k chars`;
}
