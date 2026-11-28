// zoho.ts — Zoho Books client for ONE instance. Owns OAuth refresh + retry;
// never owns credentials (they arrive decrypted from the store).
//
// Access tokens are cached in the Token table (source zoho:<instanceKey>)
// because a Worker isolate restart would otherwise burn a refresh on every
// cold start and Zoho rate-limits refreshes hard.

import { prisma } from '../../../../shared/prisma-d1';
import { IntegrationError, type IntegrationAdapter, type ResolvedInstance } from '../types';

export interface ZohoClient {
  organizationId: string;
  accessToken(): Promise<string>;
  request<T = any>(path: string, init?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<T>;
  getSentEstimates(opts?: { page?: number; perPage?: number }): Promise<any[]>;
  getEstimate(estimateId: string): Promise<any>;
  getComments(estimateId: string): Promise<any[]>;
  ping(): Promise<{ ok: boolean; organizations: number }>;
}

const memory = new Map<string, { token: string; expiresAt: number }>();

async function readToken(source: string): Promise<{ token: string; expiresAt: number } | null> {
  const hit = memory.get(source);
  if (hit && hit.expiresAt > Date.now()) return hit;
  try {
    const row: any = await prisma.token.findUnique({ where: { source } });
    if (!row?.token) return null;
    let expiresAt = 0;
    try { expiresAt = Number(JSON.parse(row.metadata || '{}').expiresAt || 0); } catch { expiresAt = 0; }
    if (expiresAt <= Date.now() + 30_000) return null;
    const fresh = { token: String(row.token), expiresAt };
    memory.set(source, fresh);
    return fresh;
  } catch {
    return null;
  }
}

async function writeToken(source: string, token: string, expiresAt: number): Promise<void> {
  memory.set(source, { token, expiresAt });
  const metadata = JSON.stringify({ expiresAt });
  try {
    await prisma.token.upsert({
      where: { source },
      create: { id: crypto.randomUUID(), source, token, metadata },
      update: { token, metadata, updatedAt: new Date() },
    });
  } catch {
    // Table/KV hiccup: the in-memory entry still serves this isolate.
  }
}

/** `rawCurlHeaders` may be JSON, `-H 'k: v'` lines, or plain `k: v` lines. */
export function parseRawHeaders(raw: string): Record<string, string> {
  const text = String(raw || '').trim();
  if (!text) return {};
  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text);
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)]));
    } catch {
      /* fall through to line parsing */
    }
  }
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^-H\s+/, '').replace(/^['"]|['"]$/g, '');
    const idx = cleaned.indexOf(':');
    if (idx <= 0) continue;
    out[cleaned.slice(0, idx).trim()] = cleaned.slice(idx + 1).trim();
  }
  return out;
}

export const zohoAdapter: IntegrationAdapter<ZohoClient> = {
  provider: 'zoho',
  async connect(instance: ResolvedInstance): Promise<ZohoClient> {
    const cfg = instance.config as Record<string, any>;
    const s = instance.secrets;
    const organizationId = String(cfg.organizationId ?? '');
    const accountsUrl = String(cfg.accountsUrl || 'https://accounts.zoho.in').replace(/\/+$/, '');
    const apiDomain = String(cfg.apiDomain || instance.baseUrl || 'https://www.zohoapis.in').replace(/\/+$/, '');
    const source = `zoho:${instance.instanceKey || 'default'}`;
    const authMode = String(cfg.authMode || 'oauth2');
    const bridgeHeaders = authMode === 'raw_headers_bridge' ? parseRawHeaders(s.rawCurlHeaders || '') : {};
    if (authMode === 'raw_headers_bridge') {
      if (!Object.keys(bridgeHeaders).length) {
        throw new IntegrationError('zoho', 'instance is missing rawCurlHeaders', 409);
      }
    } else {
      if (!organizationId) throw new IntegrationError('zoho', 'instance is missing organizationId', 409);
      if (!s.clientId || !s.clientSecret || !s.refreshToken) {
        throw new IntegrationError('zoho', 'instance is missing OAuth credentials', 409);
      }
    }

    async function refresh(): Promise<string> {
      const qs = new URLSearchParams({
        refresh_token: s.refreshToken,
        client_id: s.clientId,
        client_secret: s.clientSecret,
        grant_type: 'refresh_token',
      });
      const res = await fetch(`${accountsUrl}/oauth/v2/token?${qs.toString()}`, { method: 'POST' });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || !data?.access_token) {
        throw new IntegrationError('zoho', `token refresh failed (${res.status}): ${data?.error ?? 'no access_token'}`, 502);
      }
      const expiresAt = Date.now() + (Number(data.expires_in ?? 3600) - 60) * 1000;
      await writeToken(source, String(data.access_token), expiresAt);
      return String(data.access_token);
    }

    async function accessToken(): Promise<string> {
      if (authMode === 'raw_headers_bridge') return '';
      const hit = await readToken(source);
      return hit ? hit.token : refresh();
    }

    async function request<T>(path: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<T> {
      const url = /^https?:\/\//i.test(path) ? path : `${apiDomain}${path.startsWith('/') ? path : '/' + path}`;
      const once = async (token: string) => fetch(url, {
        method: init.method ?? 'GET',
        body: init.body,
        headers: {
          ...(authMode === 'raw_headers_bridge' ? bridgeHeaders : { Authorization: `Zoho-oauthtoken ${token}` }),
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
      });
      let res = await once(await accessToken());
      if (res.status === 401 && authMode !== 'raw_headers_bridge') {
        memory.delete(source);
        res = await once(await refresh());
      }
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new IntegrationError('zoho', `Zoho ${res.status}: ${data?.message ?? data?.code ?? url}`, res.status === 429 ? 429 : 502);
      }
      return data as T;
    }

    return {
      organizationId,
      accessToken,
      request,
      async getSentEstimates(opts = {}) {
        const page = opts.page ?? 1;
        const perPage = Math.min(opts.perPage ?? 100, 200);
        const data = await request<any>(
          `/books/v3/estimates?organization_id=${encodeURIComponent(organizationId)}` +
            `&filter_by=Status.All&sort_column=last_modified_time&sort_order=D&per_page=${perPage}&page=${page}`,
        );
        return (data?.estimates ?? []) as any[];
      },
      async getEstimate(estimateId: string) {
        const data = await request<any>(`/books/v3/estimates/${encodeURIComponent(estimateId)}?organization_id=${encodeURIComponent(organizationId)}`);
        return data?.estimate ?? null;
      },
      async getComments(estimateId: string) {
        const data = await request<any>(`/books/v3/estimates/${encodeURIComponent(estimateId)}/comments?organization_id=${encodeURIComponent(organizationId)}`);
        return (data?.comments ?? []) as any[];
      },
      async ping() {
        const data = await request<any>('/books/v3/organizations');
        return { ok: true, organizations: (data?.organizations ?? []).length };
      },
    };
  },
};
