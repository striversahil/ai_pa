// web-search.ts — default `web_search` tool for engine copilots.
//
// Edge-safe (fetch only, no Node deps). Provider chain, first non-empty win:
// keyed providers first (Tavily → Brave → Serper, via worker secrets), then a
// keyless DuckDuckGo-lite scrape so search works with zero configuration.
// Upgrade path for production-grade results: set ONE worker secret —
//   printf '%s' "$KEY" | npx wrangler secret put TAVILY_API_KEY
// (or BRAVE_SEARCH_API_KEY / SERPER_API_KEY). Never log or return the keys.
import type { ToolDefinition } from './ai-gateway';

export const WEB_SEARCH_TOOL = 'web_search';

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutput {
  results: WebResult[];
  provider: string;
  note?: string;
}

export function webSearchToolDef(): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: WEB_SEARCH_TOOL,
      description: 'Search the public web for current or external facts (market prices, spec standards, vendor info, news). Use whenever the user asks about anything outside the internal catalogue, or to verify a real-world fact. Returns title/url/snippet results — always cite the source URL when you use one.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'number', description: 'Max results, 1-8 (default 5)' },
        },
        required: ['query'],
      },
    },
  };
}

const FETCH_TIMEOUT_MS = 10_000;

function key(env: Record<string, unknown>, name: string): string {
  return String((env as any)?.[name] ?? '').trim();
}

async function fetchJson(url: string, init: RequestInit): Promise<any | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
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

async function fetchText(url: string, headers?: Record<string, string>): Promise<string | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ac.signal });
    if (!res.ok) return null;
    return await res.text().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCharCode(parseInt(h, 16)); } catch { return ''; } })
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(Number(n)); } catch { return ''; } })
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function clean(s: unknown, max = 300): string {
  return decodeEntities(String(s ?? '').replace(/\s+/g, ' ').trim()).slice(0, max);
}

async function viaTavily(apiKey: string, query: string, count: number): Promise<WebResult[] | null> {
  const data = await fetchJson('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: count, include_answer: false, search_depth: 'basic' }),
  });
  if (!data || !Array.isArray((data as any).results)) return null;
  return (data as any).results.slice(0, count).map((r: any) => ({
    title: clean(r?.title, 140),
    url: clean(r?.url, 300),
    snippet: clean(r?.content, 300),
  })).filter((r: WebResult) => r.title && r.url);
}

async function viaBrave(apiKey: string, query: string, count: number): Promise<WebResult[] | null> {
  const data = await fetchJson(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
  });
  const web = (data as any)?.web?.results;
  if (!Array.isArray(web)) return null;
  return web.slice(0, count).map((r: any) => ({
    title: clean(r?.title, 140),
    url: clean(r?.url, 300),
    snippet: clean(r?.description, 300),
  })).filter((r: WebResult) => r.title && r.url);
}

async function viaSerper(apiKey: string, query: string, count: number): Promise<WebResult[] | null> {
  const data = await fetchJson('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: query, num: count }),
  });
  const organic = (data as any)?.organic;
  if (!Array.isArray(organic)) return null;
  return organic.slice(0, count).map((r: any) => ({
    title: clean(r?.title, 140),
    url: clean(r?.link, 300),
    snippet: clean(r?.snippet, 300),
  })).filter((r: WebResult) => r.title && r.url);
}

/** Keyless fallback: DuckDuckGo lite HTML. No snippets — title + URL only. */
async function viaDuckDuckGo(query: string, count: number): Promise<WebResult[] | null> {
  const html = await fetchText(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    'User-Agent': 'Mozilla/5.0 (compatible; FounderOS/1.0)',
  });
  if (!html || /anomaly-modal|challenge/i.test(html)) return null;
  const out: WebResult[] = [];
  // Result links are ddg redirects: //duckduckgo.com/l/?uddg=<encoded-url>
  const re = /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < count) {
    const href = String(m[1] ?? '');
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    const url = uddg ? (() => { try { return decodeURIComponent(uddg[1]); } catch { return ''; } })() : '';
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const title = clean(String(m[2] ?? '').replace(/<[^>]+>/g, ' '), 140);
    if (!title) continue;
    if (out.some((r) => r.url === url)) continue;
    out.push({ title, url: clean(url, 300), snippet: '' });
  }
  return out;
}

export async function execWebSearch(
  env: Record<string, unknown>,
  query: string,
  count?: unknown,
): Promise<WebSearchOutput> {
  const q = String(query ?? '').trim().slice(0, 300);
  if (!q) return { results: [], provider: 'none', note: 'empty query' };
  const n = Math.min(8, Math.max(1, Math.floor(Number(count) || 5)));
  const tavily = key(env, 'TAVILY_API_KEY');
  const brave = key(env, 'BRAVE_SEARCH_API_KEY');
  const serper = key(env, 'SERPER_API_KEY');
  if (tavily) {
    const r = await viaTavily(tavily, q, n).catch(() => null);
    if (r && r.length) return { results: r, provider: 'tavily' };
  }
  if (brave) {
    const r = await viaBrave(brave, q, n).catch(() => null);
    if (r && r.length) return { results: r, provider: 'brave' };
  }
  if (serper) {
    const r = await viaSerper(serper, q, n).catch(() => null);
    if (r && r.length) return { results: r, provider: 'serper' };
  }
  const ddg = await viaDuckDuckGo(q, n).catch(() => null);
  if (ddg && ddg.length) {
    return { results: ddg, provider: 'duckduckgo', note: 'keyless fallback — titles/URLs only, no snippets. Set TAVILY_API_KEY for full results.' };
  }
  return { results: [], provider: 'none', note: 'web search unavailable right now — answer from internal data or say so' };
}

/** Chime label for the UI (engine uses this directly, not the dept def). */
export function webSearchActivity(args: Record<string, any>, out: { result: unknown }): string {
  const r = (out.result ?? {}) as WebSearchOutput;
  const n = Array.isArray(r.results) ? r.results.length : 0;
  if (n === 0) return 'Web search · no results';
  return `Searched web · ${n} result${n === 1 ? '' : 's'}`;
}
