// google-search.ts — Programmable Search (cx + key) for company/GST lookups.

import { IntegrationError, type IntegrationAdapter, type ResolvedInstance } from '../types';

export interface GoogleSearchClient {
  search(query: string, opts?: { num?: number; start?: number }): Promise<any[]>;
  ping(): Promise<{ ok: boolean }>;
}

export const googleSearchAdapter: IntegrationAdapter<GoogleSearchClient> = {
  provider: 'google_search',
  async connect(instance: ResolvedInstance): Promise<GoogleSearchClient> {
    const cfg = instance.config as Record<string, any>;
    const key = instance.secrets.apiKey;
    const cx = String(cfg.cx || '');
    const base = String(cfg.baseUrlOverride || 'https://www.googleapis.com/customsearch/v1').replace(/\/+$/, '');
    if (!key || !cx) throw new IntegrationError('google_search', 'instance is missing apiKey or cx', 409);

    async function run(query: string, opts: { num?: number; start?: number } = {}) {
      const qs = new URLSearchParams({ key, cx, q: query, num: String(Math.min(opts.num ?? 10, 10)) });
      if (opts.start) qs.set('start', String(opts.start));
      const res = await fetch(`${base}?${qs.toString()}`);
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new IntegrationError('google_search', `Search ${res.status}: ${data?.error?.message || ''}`, res.status === 429 ? 429 : 502);
      }
      return (data?.items ?? []) as any[];
    }

    return {
      search: run,
      async ping() {
        await run('founder os', { num: 1 });
        return { ok: true };
      },
    };
  },
};
