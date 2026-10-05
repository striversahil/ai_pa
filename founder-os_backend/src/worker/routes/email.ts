// ─────────────────────────────────────────────────────────────────────────────
// routes/email.ts — modular email service (Gmail API).
// Connect a Gmail once (OAuth dance or pasted refresh token), then:
//   POST /api/email/send      — send now to anyone
//   POST /api/email/draft     — save a Gmail draft
//   GET  /api/email/drafts    — list drafts
//   DELETE /api/email/draft   — delete a draft
//   POST /api/email/schedule  — one-shot (sendAt) or daily cron (repeatDailyAt)
//   GET  /api/email/outbox    — scheduled queue + GET /log — send history
// Writes are ROOT-only (sending as the company is the founder's key).
// Reads ride the dashboard session. OAuth callback is AUTH_EXEMPT (Google
// redirects here) so it enforces the root session itself — a bare state
// token is never enough to connect an account.
// Tokens live ONLY in CACHE_KV (email:oauth:<accountId>).
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { authStore, notifyLive, type Bindings } from '../context';
import { requireUser } from '../../modules/auth/service';
import { ROOT_EMAIL } from '../../modules/auth/types';
import type { EmailEnv } from '../../automations/email/service';
import * as svc from '../../automations/email/service';
import * as store from '../../automations/email/store';

function kvStore(env: Bindings) {
  const KV = (env as any).CACHE_KV as any;
  return {
    get: async (k: string) => (KV ? (await KV.get(k).catch(() => null)) as string | null : null),
    put: async (k: string, v: string) => { await KV?.put(k, v); },
    delete: async (k: string) => { await KV?.delete(k); },
  };
}

function emailEnv(env: Bindings): EmailEnv {
  return {
    DB: (env as any).DB,
    tokens: kvStore(env),
    googleClientId: (env as any).GOOGLE_CLIENT_ID,
    googleClientSecret: (env as any).GOOGLE_CLIENT_SECRET,
    publicOrigin: String((env as any).PUBLIC_ORIGIN ?? (env as any).AUTH_PUBLIC_ORIGIN ?? 'https://founder-os-worker.connect-bui2.workers.dev'),
  };
}

/** Root gate: returns null when allowed, otherwise the denial response. */
async function rootOnly(c: any): Promise<Response | null> {
  try {
    const me = await requireUser(authStore(c), c.req.header('cookie') ?? null);
    if (me.isRoot || (me as any)?.user?.email === ROOT_EMAIL) return null;
    return c.json({ ok: false, error: 'Root only' }, 403);
  } catch (e: any) {
    const status = typeof (e as any)?.status === 'number' ? (e as any).status : 401;
    return c.json({ ok: false, error: (e as any)?.message ?? 'Authentication required' }, status);
  }
}

export function registerEmailRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // Status: accounts + connection flags + queue depth. Session gate only.
  app.get('/api/email/status', async (c) => {
    try {
      return c.json({ ok: true, ...(await svc.statusSnapshot(emailEnv(c.env as any))) });
    } catch (e: any) { return c.json({ ok: false, error: e?.message ?? 'status failed' }, 500); }
  });

  // Connect with a pasted refresh token (Google OAuth Playground path). Root.
  app.post('/api/email/connect', async (c) => {
    const denied = await rootOnly(c);
    if (denied) return denied;
    try {
      const body = await c.req.json().catch(() => ({}));
      const acc = await svc.connectWithToken(
        emailEnv(c.env as any), String(body?.label ?? ''), String(body?.refreshToken ?? ''));
      notifyLive(c, { type: 'email' });
      return c.json({ ok: true, account: acc });
    } catch (e: any) { return c.json({ ok: false, error: e?.message ?? 'connect failed' }, 400); }
  });

  // OAuth dance. Start is root (redirects to Google); callback checks root itself.
  // Start takes ?account=<id> or ?email=<addr>&label=<name> (find-or-create).
  app.get('/api/email/oauth/start', async (c) => {
    const denied = await rootOnly(c);
    if (denied) return denied;
    try {
      const url = await svc.oauthStart(emailEnv(c.env as any), {
        accountId: String(c.req.query('account') ?? '') || undefined,
        email: String(c.req.query('email') ?? '') || undefined,
        label: String(c.req.query('label') ?? '') || undefined,
      });
      return c.redirect(url, 302);
    } catch (e: any) { return c.json({ ok: false, error: e?.message ?? 'oauth start failed' }, 400); }
  });

  app.get('/api/email/oauth/callback', async (c) => {
    const err = c.req.query('error');
    if (err || !c.req.query('code')) return c.text(`Google declined: ${err || 'no code'} — close and retry Connect.`, 400);
    // Exempt from the global gate, so the root session is checked here:
    // only the founder's own browser can finish connecting an account.
    if (await rootOnly(c)) {
      return c.text('Root only — sign in as root in this browser, then retry Connect.', 403);
    }
    try {
      const r = await svc.oauthCallback(
        emailEnv(c.env as any), String(c.req.query('code') ?? ''), String(c.req.query('state') ?? ''));
      notifyLive(c, { type: 'email' });
      return c.text(`Email connected ✓ (${r.email}) — return to the Founder OS dashboard; send, drafts and scheduling are live for this account.`, 200);
    } catch (e: any) {
      return c.text(`Email connect failed: ${e?.message} — close and retry Connect.`, 400);
    }
  });

  // Disconnect (revoke locally: KV token deleted, account flagged). Root.
  app.post('/api/email/disconnect', async (c) => {
    const denied = await rootOnly(c);
    if (denied) return denied;
    try {
      await svc.disconnect(emailEnv(c.env as any), String((await c.req.json().catch(() => ({})))?.accountId ?? ''));
      notifyLive(c, { type: 'email' });
      return c.json({ ok: true });
    } catch (e: any) { return c.json({ ok: false, error: e?.message ?? 'disconnect failed' }, 400); }
  });

  // Send now. Root.
  app.post('/api/email/send', async (c) => {
    const denied = await rootOnly(c);
    if (denied) return denied;
    try {
      const body = await c.req.json().catch(() => ({}));
      const r = await svc.sendNow(emailEnv(c.env as any), String(body?.accountId ?? ''), body);
      notifyLive(c, { type: 'email' });
      return c.json({ ok: true, gmailId: r.gmailId });
    } catch (e: any) { return c.json({ ok: false, error: e?.message ?? 'send failed' }, 400); }
  });

  // Save a Gmail draft. Root.
  app.post('/api/email/draft', async (c) => {
    const denied = await rootOnly(c);
    if (denied) return denied;
    try {
      const body = await c.req.json().catch(() => ({}));
      const r = await svc.saveDraft(emailEnv(c.env as any), String(body?.accountId ?? ''), body);
      notifyLive(c, { type: 'email' });
      return c.json({ ok: true, draftId: r.draftId });
    } catch (e: any) { return c.json({ ok: false, error: e?.message ?? 'draft failed' }, 400); }
  });

  // List / delete drafts. List rides session; delete is root.
  app.get('/api/email/drafts', async (c) => {
    try {
      const drafts = await svc.listDrafts(emailEnv(c.env as any),
        String(c.req.query('account') ?? ''), Number(c.req.query('max') ?? 20));
      return c.json({ ok: true, drafts });
    } catch (e: any) { return c.json({ ok: false, error: e?.message ?? 'drafts failed' }, 400); }
  });

  app.delete('/api/email/draft', async (c) => {
    const denied = await rootOnly(c);
    if (denied) return denied;
    try {
      await svc.deleteDraft(emailEnv(c.env as any),
        String(c.req.query('account') ?? ''), String(c.req.query('draftId') ?? ''));
      notifyLive(c, { type: 'email' });
      return c.json({ ok: true });
    } catch (e: any) { return c.json({ ok: false, error: e?.message ?? 'delete failed' }, 400); }
  });

  // Schedule: {sendAt: ISO} one-shot or {repeatDailyAt: "HH:MM" IST}. Root.
  app.post('/api/email/schedule', async (c) => {
    const denied = await rootOnly(c);
    if (denied) return denied;
    try {
      const body = await c.req.json().catch(() => ({}));
      const item = await svc.scheduleMail(emailEnv(c.env as any),
        String(body?.accountId ?? ''), body,
        { sendAt: body?.sendAt, repeatDailyAt: body?.repeatDailyAt });
      notifyLive(c, { type: 'email' });
      return c.json({ ok: true, item });
    } catch (e: any) { return c.json({ ok: false, error: e?.message ?? 'schedule failed' }, 400); }
  });

  // Queue + history + cancel. Cancel is root; reads ride session.
  app.get('/api/email/outbox', async (c) => {
    try {
      return c.json({ ok: true, outbox: await store.listOutbox((c.env as any).DB, 50) });
    } catch (e: any) { return c.json({ ok: false, error: e?.message ?? 'outbox failed' }, 500); }
  });

  app.delete('/api/email/outbox/:id', async (c) => {
    const denied = await rootOnly(c);
    if (denied) return denied;
    const cancelled = await store.cancelOutbox((c.env as any).DB, c.req.param('id') ?? '');
    if (!cancelled) return c.json({ ok: false, error: 'already sent, sending, or unknown' }, 409);
    notifyLive(c, { type: 'email' });
    return c.json({ ok: true });
  });

  app.get('/api/email/log', async (c) => {
    try {
      return c.json({ ok: true, log: await store.listLog((c.env as any).DB, 50) });
    } catch (e: any) { return c.json({ ok: false, error: e?.message ?? 'log failed' }, 500); }
  });
}
