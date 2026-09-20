import type { PagesFunction } from '@cloudflare/workers-types';

// Pages Function: proxy /api/* to the founder-os worker.
export const onRequest: PagesFunction = async ({ request, env }) => {
  const target = (env.API_WORKER_URL as string) || 'https://founder-os-worker.connect-bui2.workers.dev';
  const url = new URL(request.url);
  const dest = new URL('/api' + url.pathname.replace(/^\/api/, '') + url.search, target);
  const upstream = new Request(dest.toString(), request);
  upstream.headers.set('origin', target);
  // Crucial for SSE: don't buffer, pass the Worker stream through verbatim
  const res = await fetch(upstream);
  const headers = new Headers(res.headers);
  headers.set('X-Accel-Buffering', 'no');
  headers.set('Cache-Control', 'no-cache');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};