// Pages Function: proxy /health/* to the founder-os worker.
export const onRequest: PagesFunction = async ({ request, env }) => {
  const target = (env.API_WORKER_URL as string) || 'https://founder-os-worker.connect-bui2.workers.dev';
  const url = new URL(request.url);
  const dest = new URL('/health' + url.pathname.replace(/^\/health/, '') + url.search, target);
  const upstream = new Request(dest.toString(), request);
  return fetch(upstream);
};