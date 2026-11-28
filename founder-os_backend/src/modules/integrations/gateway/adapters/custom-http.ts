// custom-http.ts — the generic outbound HTTP client AND the portal/social
// adapters that only differ by default host/auth convention.
//
// Auth schemes: bearer | custom_header | basic | query_param | none.
// 429/5xx retried twice with backoff; XML bodies pass through as strings.

import { getProviderManifest } from '../manifest';
import { IntegrationError, type IntegrationAdapter, type ResolvedInstance } from '../types';

export interface CustomHttpClient {
  provider: string;
  baseUrl: string;
  request<T = unknown>(
    path: string,
    opts?: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number },
  ): Promise<{ ok: boolean; status: number; data: T }>;
  get<T = unknown>(path: string, headers?: Record<string, string>): Promise<{ ok: boolean; status: number; data: T }>;
  post<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>): Promise<{ ok: boolean; status: number; data: T }>;
  ping(): Promise<{ ok: boolean; status: number }>;
}

type Scheme = 'bearer' | 'custom_header' | 'basic' | 'query_param' | 'none';

interface HostDefaults { baseUrl?: string; scheme?: Scheme; header?: string; queryParam?: string }

/** Host + convention per provider; the instance may override every part. */
const HOSTS: Record<string, HostDefaults> = {
  custom: { scheme: 'bearer' },
  tradeindia: { baseUrl: 'https://www.tradeindia.com', scheme: 'custom_header', header: 'x-api-key' },
  indiamart: { baseUrl: 'https://www.indiamart.com', scheme: 'custom_header', header: 'x-api-key' },
  justdial: { baseUrl: 'https://www.justdial.com', scheme: 'custom_header', header: 'x-api-key' },
  exportersindia: { baseUrl: 'https://www.exportersindia.com', scheme: 'custom_header', header: 'x-api-key' },
  alibaba: { baseUrl: 'https://openapi.alibaba.com', scheme: 'bearer' },
  facebook: { baseUrl: 'https://graph.facebook.com/v21.0', scheme: 'bearer' },
  instagram: { baseUrl: 'https://graph.facebook.com/v21.0', scheme: 'bearer' },
  linkedin: { baseUrl: 'https://api.linkedin.com/v2', scheme: 'bearer' },
  telegram: { baseUrl: 'https://api.telegram.org', scheme: 'none' },
  google_forms: { baseUrl: 'https://forms.googleapis.com/v1', scheme: 'bearer' },
  tally: { scheme: 'none' },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pickToken(instance: ResolvedInstance): string {
  const s = instance.secrets as Record<string, string>;
  return String(
    s.authToken || s.apiKey || s.pageAccessToken || s.accessToken || s.botToken || s.appSecret || s.appKey || '',
  );
}

export function httpAdapterFor(provider: string, defaults: HostDefaults = {}): IntegrationAdapter<CustomHttpClient> {
  const hinted = HOSTS[provider] || {};
  return {
    provider,
    async connect(instance: ResolvedInstance): Promise<CustomHttpClient> {
      const cfg = instance.config as Record<string, any>;
      const manifest = getProviderManifest(provider);
      const baseUrl = String(cfg.baseUrl || instance.baseUrl || defaults.baseUrl || hinted.baseUrl || '').replace(/\/+$/, '');
      if (!baseUrl) throw new IntegrationError(provider, 'instance is missing baseUrl', 409);
      const scheme = String(cfg.authScheme || defaults.scheme || hinted.scheme || 'bearer').toLowerCase() as Scheme;
      const token = pickToken(instance);
      const headerName = String(cfg.authHeaderName || defaults.header || hinted.header || 'Authorization');
      const queryParam = String(cfg.authQueryParam || defaults.queryParam || hinted.queryParam || 'api_key');

      const auth: Record<string, string> = {};
      if (token && scheme !== 'none') {
        if (scheme === 'bearer') auth.Authorization = `Bearer ${token}`;
        else if (scheme === 'basic') auth.Authorization = `Basic ${btoa(`${cfg.username || 'user'}:${token}`)}`;
        else if (scheme === 'custom_header') auth[headerName] = token;
      }

      function withQuery(url: string): string {
        if (scheme !== 'query_param' || !token) return url;
        const u = new URL(url);
        u.searchParams.set(queryParam, token);
        return u.toString();
      }

      async function once(url: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number }) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
        try {
          const body = opts.body === undefined ? undefined
            : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
          const res = await fetch(withQuery(url), {
            method: opts.method ?? 'GET',
            headers: {
              ...(body !== undefined ? { 'Content-Type': typeof opts.body === 'string' ? 'application/xml' : 'application/json' } : {}),
              ...auth,
              ...(opts.headers ?? {}),
            },
            body,
            signal: controller.signal,
          });
          const text = await res.text();
          let data: any = text;
          try { data = JSON.parse(text); } catch { /* keep text (Tally XML) */ }
          return { ok: res.ok, status: res.status, data: data as unknown };
        } finally {
          clearTimeout(timer);
        }
      }

      async function request<T>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {}) {
        const url = /^https?:\/\//i.test(path) ? path : `${baseUrl}${path.startsWith('/') ? path : '/' + path}`;
        let last: { ok: boolean; status: number; data: T } | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          last = (await once(url, opts)) as { ok: boolean; status: number; data: T };
          if (last.ok || (last.status !== 429 && last.status < 500)) return last;
          if (attempt < 2) await sleep(300 * (attempt + 1));
        }
        return last as { ok: boolean; status: number; data: T };
      }

      return {
        provider,
        baseUrl,
        request,
        get: (path, headers) => request(path, { headers }),
        post: (path, body, headers) => request(path, { method: 'POST', body, headers }),
        async ping() {
          const res = await once(baseUrl, { method: 'GET', timeoutMs: 10_000 });
          return { ok: res.ok, status: res.status };
        },
      };
    },
  };
}

/** The convenience instance for `call('custom', { instanceKey })`. */
export const customHttpAdapter = httpAdapterFor('custom', HOSTS.custom);

/** Every provider whose outbound story is just HTTP + a host convention. */
export const portalAdapters: IntegrationAdapter<CustomHttpClient>[] = [
  'indiamart', 'tradeindia', 'justdial', 'exportersindia', 'alibaba',
  'facebook', 'instagram', 'linkedin', 'telegram', 'google_forms', 'tally',
].map((provider) => httpAdapterFor(provider, HOSTS[provider]));
