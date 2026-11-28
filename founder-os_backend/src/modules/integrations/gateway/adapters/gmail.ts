// gmail.ts — Google OAuth2 mailbox for ONE instance. Tokens are cached in the
// Token table as gmail:<instanceKey> and refreshed once on a 401.

import { prisma } from '../../../../shared/prisma-d1';
import { IntegrationError, type IntegrationAdapter, type ResolvedInstance } from '../types';

export interface GmailClient {
  userId: string;
  listMessages(query?: string, maxResults?: number): Promise<any[]>;
  getMessage(id: string, format?: 'full' | 'metadata' | 'minimal'): Promise<any>;
  sendMessage(rawBase64Url: string): Promise<any>;
  createDraft(rawBase64Url: string): Promise<any>;
  ping(): Promise<{ ok: boolean; email?: string; messagesTotal?: number }>;
}

const memory = new Map<string, { token: string; expiresAt: number }>();

async function readToken(source: string) {
  const hit = memory.get(source);
  if (hit && hit.expiresAt > Date.now()) return hit;
  try {
    const row: any = await prisma.token.findUnique({ where: { source } });
    if (!row?.token) return null;
    const expiresAt = Number(JSON.parse(row.metadata || '{}').expiresAt || 0);
    if (expiresAt <= Date.now() + 30_000) return null;
    const fresh = { token: String(row.token), expiresAt };
    memory.set(source, fresh);
    return fresh;
  } catch {
    return null;
  }
}

async function writeToken(source: string, token: string, expiresAt: number) {
  memory.set(source, { token, expiresAt });
  const metadata = JSON.stringify({ expiresAt });
  try {
    await prisma.token.upsert({
      where: { source },
      create: { id: crypto.randomUUID(), source, token, metadata },
      update: { token, metadata, updatedAt: new Date() },
    });
  } catch {
    /* in-memory entry still serves this isolate */
  }
}

export const gmailAdapter: IntegrationAdapter<GmailClient> = {
  provider: 'gmail',
  async connect(instance: ResolvedInstance): Promise<GmailClient> {
    const cfg = instance.config as Record<string, any>;
    const s = instance.secrets;
    const userId = String(cfg.userId || 'me');
    const source = `gmail:${instance.instanceKey || 'default'}`;
    if (!s.clientId || !s.clientSecret || !s.refreshToken) {
      throw new IntegrationError('gmail', 'instance is missing OAuth credentials', 409);
    }

    async function refresh(): Promise<string> {
      const body = new URLSearchParams({
        client_id: s.clientId, client_secret: s.clientSecret,
        refresh_token: s.refreshToken, grant_type: 'refresh_token',
      });
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || !data?.access_token) {
        throw new IntegrationError('gmail', `token refresh failed (${res.status})`, 502);
      }
      const expiresAt = Date.now() + (Number(data.expires_in ?? 3600) - 60) * 1000;
      await writeToken(source, String(data.access_token), expiresAt);
      return String(data.access_token);
    }

    async function accessToken(): Promise<string> {
      const hit = await readToken(source);
      return hit ? hit.token : refresh();
    }

    async function request<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
      const url = path.startsWith('http') ? path : `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userId)}${path}`;
      const once = (token: string) => fetch(url, {
        method: init.method ?? 'GET',
        headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
      let res = await once(await accessToken());
      if (res.status === 401) {
        memory.delete(source);
        res = await once(await refresh());
      }
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new IntegrationError('gmail', `Gmail ${res.status}: ${data?.error?.message || ''}`, res.status === 429 ? 429 : 502);
      }
      return data as T;
    }

    return {
      userId,
      async listMessages(query, maxResults = 25) {
        const qs = new URLSearchParams({ maxResults: String(Math.min(maxResults, 100)) });
        if (query) qs.set('q', query);
        const data = await request<any>(`/messages?${qs.toString()}`);
        return data?.messages ?? [];
      },
      async getMessage(id, format = 'full') {
        return request<any>(`/messages/${encodeURIComponent(id)}?format=${format}`);
      },
      async sendMessage(rawBase64Url) {
        return request<any>('/messages/send', { method: 'POST', body: { raw: rawBase64Url } });
      },
      async createDraft(rawBase64Url) {
        return request<any>('/drafts', { method: 'POST', body: { message: { raw: rawBase64Url } } });
      },
      async ping() {
        const data = await request<any>('/profile');
        return { ok: true, email: data?.emailAddress, messagesTotal: data?.messagesTotal };
      },
    };
  },
};
