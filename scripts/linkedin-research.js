// linkedin-research.js — web research for the daily LinkedIn pipeline.
// Provider chain mirrors founder-os_backend/src/shared/web-search.ts (worker):
// keyed providers first (Tavily → Brave → Serper, via GH secrets), then a
// keyless DuckDuckGo-lite scrape so research works with zero configuration.
// Returns [{ title, url, snippet }] with the provider name for the brief's
// source line. No D1, no AI — pure retrieval.

'use strict';

const FETCH_TIMEOUT_MS = 10000;

async function fetchJson(url, init) {
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

async function viaTavily(apiKey, query, count) {
  const d = await fetchJson('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: count, include_answer: false, search_depth: 'basic' }),
  });
  if (!d || !Array.isArray(d.results) || !d.results.length) return null;
  return d.results.slice(0, count).map((r) => ({ title: r.title || '', url: r.url || '', snippet: r.content || r.snippet || '' }));
}

async function viaBrave(apiKey, query, count) {
  const d = await fetchJson(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
  });
  const items = (d && d.web && d.web.results) || [];
  if (!items.length) return null;
  return items.slice(0, count).map((r) => ({ title: r.title || '', url: r.url || '', snippet: r.description || '' }));
}

async function viaSerper(apiKey, query, count) {
  const d = await fetchJson('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: query, num: count }),
  });
  const items = (d && d.organic) || [];
  if (!items.length) return null;
  return items.slice(0, count).map((r) => ({ title: r.title || '', url: r.link || '', snippet: r.snippet || '' }));
}

async function viaDuckDuckGo(query, count) {
  // Keyless fallback — titles/URLs only, no snippets.
  const d = await fetchJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
    headers: { Accept: 'application/json' },
  });
  const topics = (d && d.RelatedTopics) || [];
  const out = [];
  for (const t of topics) {
    if (out.length >= count) break;
    if (t && t.Text && t.FirstURL) out.push({ title: t.Text.slice(0, 120), url: t.FirstURL, snippet: '' });
  }
  return out.length ? out : null;
}

async function webResearch(query, count = 5) {
  const tavily = String(process.env.TAVILY_API_KEY || '').trim();
  const brave = String(process.env.BRAVE_SEARCH_API_KEY || '').trim();
  const serper = String(process.env.SERPER_API_KEY || '').trim();
  if (tavily) {
    const r = await viaTavily(tavily, query, count).catch(() => null);
    if (r) return { results: r, provider: 'tavily' };
  }
  if (brave) {
    const r = await viaBrave(brave, query, count).catch(() => null);
    if (r) return { results: r, provider: 'brave' };
  }
  if (serper) {
    const r = await viaSerper(serper, query, count).catch(() => null);
    if (r) return { results: r, provider: 'serper' };
  }
  const ddg = await viaDuckDuckGo(query, count).catch(() => null);
  if (ddg) return { results: ddg, provider: 'duckduckgo', note: 'keyless fallback — titles/URLs only. Set TAVILY_API_KEY for full snippets.' };
  return { results: [], provider: 'none', note: 'all search providers failed' };
}

module.exports = { webResearch };
