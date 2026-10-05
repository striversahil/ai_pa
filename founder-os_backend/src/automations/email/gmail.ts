// automations/email/gmail.ts — Gmail provider: OAuth dance + Gmail API
// (send, drafts create/list/delete). Pure fetch, no Node deps, so the Worker
// bundle and plain Node (Express mirror, scripts) can both import it.
//
// Scope: https://mail.google.com/ (gmail.full) — view, compose, send, delete,
// labels, settings: every Gmail permission in one grant, so future operations
// (read inbox, labels, filters, delegation) need no re-consent. Tokens live
// in the caller's TokenStore under email:oauth:<accountId> — never in D1,
// never in responses.

import type { DraftSummary, EmailProvider } from './types';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export const GMAIL_SCOPES = ['https://mail.google.com/'].join(' ');

export const oauthKey = (accountId: string) => `email:oauth:${accountId}`;
export const OAUTH_STATE_PREFIX = 'email:oauth:state:';

export function redirectUri(publicOrigin: string): string {
  return `${String(publicOrigin).replace(/\/$/, '')}/api/email/oauth/callback`;
}

export const gmailProvider: EmailProvider = {
  name: 'gmail',

  oauthStartUrl({ clientId, redirectUri: ru, state }) {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: ru,
      scope: GMAIL_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${GOOGLE_AUTH}?${q}`;
  },

  async exchangeCode({ clientId, clientSecret, redirectUri: ru, code }) {
    const tok = await tokenRequest({
      grant_type: 'authorization_code', code,
      client_id: clientId, client_secret: clientSecret, redirect_uri: ru,
    });
    if (!tok.refresh_token) {
      throw new Error('Google returned no refresh_token — re-consent with prompt=consent (remove app access at myaccount.google.com/permissions first).');
    }
    return { accessToken: tok.access_token, refreshToken: tok.refresh_token, expiresIn: Number(tok.expires_in) || 3600 };
  },

  async refreshAccessToken({ clientId, clientSecret, refreshToken }) {
    const tok = await tokenRequest({
      grant_type: 'refresh_token', refresh_token: refreshToken,
      client_id: clientId, client_secret: clientSecret,
    });
    return { accessToken: tok.access_token, expiresIn: Number(tok.expires_in) || 3600 };
  },

  async getProfile(accessToken) {
    const res = await fetch(`${GMAIL_API}/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.emailAddress) {
      // Surface Google's reason (e.g. accessNotConfigured = Gmail API not
      // enabled on the project; insufficient scopes = re-consent needed).
      throw new Error(`gmail profile failed: HTTP ${res.status} ${j?.error?.message ?? j?.error?.status ?? ''}`.trim());
    }
    return { email: String(j.emailAddress) };
  },

  async sendRaw(accessToken, rawBase64Url) {
    const res = await fetch(`${GMAIL_API}/messages/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: rawBase64Url }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.id) throw new Error(`gmail send failed: HTTP ${res.status} ${j?.error?.message ?? ''}`.trim());
    return { gmailId: String(j.id) };
  },

  async createDraftRaw(accessToken, rawBase64Url) {
    const res = await fetch(`${GMAIL_API}/drafts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: rawBase64Url } }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.id) throw new Error(`gmail draft failed: HTTP ${res.status} ${j?.error?.message ?? ''}`.trim());
    return { draftId: String(j.id) };
  },

  async listDrafts(accessToken, max = 20) {
    const n = Math.max(1, Math.min(50, Number(max) || 20));
    const lr = await fetch(`${GMAIL_API}/drafts?maxResults=${n}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const lj = await lr.json().catch(() => ({}));
    if (!lr.ok) throw new Error(`gmail drafts list failed: HTTP ${lr.status}`);
    const items: Array<{ id: string }> = Array.isArray(lj.drafts) ? lj.drafts : [];
    const out: DraftSummary[] = await Promise.all(items.map(async (d) => {
      try {
        const r = await fetch(`${GMAIL_API}/drafts/${encodeURIComponent(d.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=To&metadataHeaders=Date`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const j = await r.json().catch(() => ({}));
        const headers: Array<{ name: string; value: string }> = j?.message?.payload?.headers ?? [];
        const pick = (n2: string) => headers.find((h) => String(h.name).toLowerCase() === n2)?.value ?? '';
        return {
          id: String(d.id), threadId: String(j?.message?.threadId ?? ''),
          snippet: String(j?.message?.snippet ?? ''),
          subject: pick('subject'), to: pick('to'), date: pick('date'),
        };
      } catch {
        return { id: String(d.id), threadId: '', snippet: '', subject: '', to: '', date: '' };
      }
    }));
    return out;
  },

  async deleteDraft(accessToken, draftId) {
    const res = await fetch(`${GMAIL_API}/drafts/${encodeURIComponent(draftId)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok && res.status !== 404) throw new Error(`gmail draft delete failed: HTTP ${res.status}`);
  },
};

async function tokenRequest(body: Record<string, string>): Promise<any> {
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`google token exchange failed: ${j.error_description || j.error || res.status}`);
  }
  return j;
}
