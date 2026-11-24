import type { PagesFunction } from '@cloudflare/workers-types';

// Pages Function: proxy /api/* to the founder-os worker.
export const onRequest: PagesFunction = async ({ request, env }) => {
  const target = (env.API_WORKER_URL as string) || 'https://founder-os-worker.connect-bui2.workers.dev';
  const url = new URL(request.url);
  const dest = new URL('/api' + url.pathname.replace(/^\/api/, '') + url.search, target);
  const upstream = new Request(dest.toString(), request);
  upstream.headers.set('origin', target);
  const res = await fetch(upstream);
  // LIVE HUB (GET /api/events): a WebSocket upgrade answers 101 with the socket
  // on `res.webSocket`. That response CANNOT be rebuilt — `new Response(body,
  // { status: 101 })` throws (the constructor only accepts 200-599), and a 101
  // without `webSocket` never completes the handshake. Hand the socket back
  // as-is or every live refetch in the app silently 500s and the whole frontend
  // degrades to fetch-once (threads/queries then look stale until a reload).
  if (res.webSocket) return new Response(null, { status: 101, webSocket: res.webSocket });
  // Crucial for SSE: don't buffer, pass the Worker stream through verbatim
  const headers = new Headers(res.headers);
  headers.set('X-Accel-Buffering', 'no');
  headers.set('Cache-Control', 'no-cache');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};
