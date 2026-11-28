// portal.ts — the B2B portals + Tally: HTTP clients with a per-provider auth
// convention. They share ONE implementation because the only differences are
// the default host and which secret header the portal expects.

import { IntegrationError, type IntegrationAdapter, type ProviderKey, type ResolvedInstance } from '../types';

export interface PortalClient {
  provider: string;
  baseUrl: string;
  request<T = unknown>(
    path: string,
    opts?: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number },
  ): Promise<{ ok: boolean; status: number; data: T }>;
  ping(): Promise<{ ok: boolean; status: number }>;
}

interface PortalDefaults {
  baseUrl: string;
  authHeader: string;
  scheme: 'bearer' | 'x-api-key' | 'basic' | 'none';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function factory(provider: ProviderKey, defaults: PortalDefaults): IntegrationAdapter<PortalClient> {
  return {
    provider,
    async connect(instance: ResolvedInstance): Promise<PortalClient> {
      const cfg = instance.config as Record<string, any>;
      const baseUrl = String(cfg.baseUrl || instance.baseUrl || defaults.baseUrl).replace(/\/+$/, '');
      if (!baseUrl) throw new IntegrationError(provider, 'instance is missing baseUrl', 409);
      const scheme = String(cfg.authScheme || defaults.scheme);
      const token = instance.secrets.apiToken || instance.secrets.apiKey || '';
      const auth: Record<string, string> = {};
      if (token && scheme !== 'none') {
        if (scheme === 'bearer') auth.Authorization = `Bearer ${token}`;
        else if (scheme === 'basic') auth.Authorization = `Basic ${btoa(token)}`;
        else auth[cfg.authHeaderName || defaults.authHeader] = token;
      }

      async function once(url: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number }) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
        try {
          const body = opts.body === undefined ? undefined
            : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
          const res = await fetch(url, {
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
          return { ok: res.ok, status: res.status, data };
        } finally {
          clearTimeout(timer);
        }
      }

      return {
        provider,
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
}

/** Tally Prime's XML gateway (push connector posts to our door; this is the
 *  outbound side used by automation, auth none). */
export const tallyAdapter = factory('tally', { baseUrl: '', authHeader: 'Authorization', scheme: 'none' });
export const tradeindiaAdapter = factory('tradeindia', { baseUrl: 'https://www.tradeindia.com', authHeader: 'x-api-key', scheme: 'x-api-key' });
export const justdialAdapter = factory('justdial', { baseUrl: 'https://www.justdial.com', authHeader: 'x-api-key', scheme: 'x-api-key' });
export const alibabaAdapter = factory('alibaba', { baseUrl: 'https://openapi.alibaba.com', authHeader: 'Authorization', scheme: 'bearer' });
