// custom-http.ts — the escape hatch: any REST endpoint, auth by header.
//
// Secrets: authToken (+ `authScheme`: bearer | x-api-key | basic).
// 429/5xx retried twice with backoff; everything else returns the response.

import { IntegrationError, type IntegrationAdapter, type ResolvedInstance } from '../types';

export interface CustomHttpClient {
  baseUrl: string;
  request<T = unknown>(
    path: string,
    opts?: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number },
  ): Promise<{ ok: boolean; status: number; data: T }>;
  ping(): Promise<{ ok: boolean; status: number }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const customHttpAdapter: IntegrationAdapter<CustomHttpClient> = {
  provider: 'custom',
  async connect(instance: ResolvedInstance): Promise<CustomHttpClient> {
    const cfg = instance.config as Record<string, any>;
    const baseUrl = String(cfg.baseUrl || instance.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl) throw new IntegrationError('custom', 'instance is missing baseUrl', 409);
    const headerName = String(cfg.authHeaderName || 'Authorization');
    const scheme = String(cfg.authScheme || 'bearer').toLowerCase();
    const token = instance.secrets.authToken;

    const auth: Record<string, string> = {};
    if (token) {
      if (scheme === 'bearer') auth[headerName || 'Authorization'] = `Bearer ${token}`;
      else if (scheme === 'basic') auth[headerName || 'Authorization'] = `Basic ${btoa(token)}`;
      else auth[headerName || 'x-api-key'] = token;
    }

    async function once(url: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
      try {
        const res = await fetch(url, {
          method: opts.method ?? 'GET',
          headers: {
            ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...auth,
            ...(opts.headers ?? {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal,
        });
        const text = await res.text();
        let data: any = text;
        try { data = JSON.parse(text); } catch { /* keep text */ }
        return { ok: res.ok, status: res.status, data };
      } finally {
        clearTimeout(timer);
      }
    }

    return {
      baseUrl,
      async request<T>(path: string, opts = {}) {
        const url = /^https?:\/\//i.test(path) ? path : `${baseUrl}${path.startsWith('/') ? path : '/' + path}`;
        let last: { ok: boolean; status: number; data: T } | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          last = (await once(url, opts)) as { ok: boolean; status: number; data: T };
          if (last.ok || (last.status !== 429 && last.status < 500)) return last;
          if (attempt < 2) await sleep(300 * (attempt + 1));
        }
        return last as { ok: boolean; status: number; data: T };
      },
      async ping() {
        const res = await once(baseUrl, { method: 'GET', timeoutMs: 10_000 });
        return { ok: res.ok, status: res.status };
      },
    };
  },
};
