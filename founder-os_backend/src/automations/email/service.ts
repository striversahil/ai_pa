// automations/email/service.ts — orchestration: token lifecycle, immediate
// send, drafts, scheduling, and the per-minute cron tick. Route handlers stay
// thin; all Gmail + D1 work happens here. `Env` is structural so Worker and
// Express can both drive it.

import { gmailProvider, oauthKey, redirectUri, OAUTH_STATE_PREFIX } from './gmail';
import type { ComposeInput, DraftSummary, TokenStore } from './types';
import { buildRawMessage, validateCompose } from './types';
import * as store from './store';
import { nextDailyDueIst } from './store';

export interface EmailEnv {
  DB: { prepare: (q: string) => any };
  tokens: TokenStore;
  googleClientId?: string;
  googleClientSecret?: string;
  publicOrigin: string;
}

function rid(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function appCreds(env: EmailEnv): { id: string; secret: string } {
  const id = String(env.googleClientId ?? '');
  const secret = String(env.googleClientSecret ?? '');
  if (!id || !secret) throw new Error('GOOGLE_CLIENT_ID/SECRET not set (worker secrets)');
  return { id, secret };
}

/** Connect with a pasted refresh token (OAuth Playground path) — MIS only. */
export async function connectWithToken(env: EmailEnv, label: string, refreshToken: string) {
  const { id, secret } = appCreds(env);
  const t = String(refreshToken).trim();
  if (!t) throw new Error('refreshToken is required');
  // Verify before storing: mint an access token + read the profile.
  const at = await gmailProvider.refreshAccessToken({ clientId: id, clientSecret: secret, refreshToken: t });
  const me = await gmailProvider.getProfile(at.accessToken);
  const account = await store.createAccount(env.DB, label || me.email, me.email);
  await env.tokens.put(oauthKey(account.id), JSON.stringify({
    refresh_token: t,
    access_token: at.accessToken,
    expires_at: Date.now() + at.expiresIn * 1000,
    email: me.email,
  }));
  return account;
}

/** OAuth dance: start URL (state in token store, 10-min TTL handled by KV).
 * Pass accountId for an existing row, or email (+label) to find-or-create. */
export async function oauthStart(env: EmailEnv, args: { accountId?: string; email?: string; label?: string }): Promise<string> {
  const { id } = appCreds(env);
  const acc = args.accountId
    ? (await store.getAccount(env.DB, args.accountId))
    : (await store.findOrCreateAccountByEmail(env.DB, String(args.email ?? ''), String(args.label ?? '')));
  if (!acc) throw new Error('unknown email account');
  const state = rid();
  await env.tokens.put(OAUTH_STATE_PREFIX + state, acc.id);
  return gmailProvider.oauthStartUrl({ clientId: id, redirectUri: redirectUri(env.publicOrigin), state });
}

export async function oauthCallback(env: EmailEnv, code: string, state: string) {
  const { id, secret } = appCreds(env);
  const accountId = await env.tokens.get(OAUTH_STATE_PREFIX + state);
  if (!accountId) throw new Error('OAuth state expired or invalid — retry Connect.');
  await env.tokens.delete(OAUTH_STATE_PREFIX + state);
  const tok = await gmailProvider.exchangeCode({
    clientId: id, clientSecret: secret, redirectUri: redirectUri(env.publicOrigin), code,
  });
  const me = await gmailProvider.getProfile(tok.accessToken);
  await env.tokens.put(oauthKey(accountId), JSON.stringify({
    refresh_token: tok.refreshToken,
    access_token: tok.accessToken,
    expires_at: Date.now() + tok.expiresIn * 1000,
    email: me.email,
  }));
  await store.setAccountStatus(env.DB, accountId, 'active');
  return { accountId, email: me.email };
}

async function getAccessToken(env: EmailEnv, accountId: string): Promise<{ access: string; from: string }> {
  const raw = await env.tokens.get(oauthKey(accountId));
  if (!raw) throw new Error('email account not connected — Connect it first.');
  const t = JSON.parse(raw);
  if (t.expires_at - Date.now() > 5 * 60_000) return { access: t.access_token, from: t.email };
  const { id, secret } = appCreds(env);
  if (!t.refresh_token) throw new Error('email session expired — reconnect the account.');
  const at = await gmailProvider.refreshAccessToken({ clientId: id, clientSecret: secret, refreshToken: t.refresh_token });
  const next = { ...t, access_token: at.accessToken, expires_at: Date.now() + at.expiresIn * 1000 };
  await env.tokens.put(oauthKey(accountId), JSON.stringify(next));
  return { access: next.access_token, from: next.email };
}

async function activeAccount(env: EmailEnv, accountId: string) {
  const acc = await store.getAccount(env.DB, accountId);
  if (!acc) throw new Error('unknown email account');
  if (acc.status !== 'active') throw new Error('email account is revoked — reconnect it.');
  return acc;
}

export async function sendNow(env: EmailEnv, accountId: string, input: Partial<ComposeInput>) {
  const m = validateCompose(input);
  const acc = await activeAccount(env, accountId);
  const { access, from } = await getAccessToken(env, accountId);
  const raw = buildRawMessage(from || acc.email, m);
  try {
    const r = await gmailProvider.sendRaw(access, raw);
    await store.addLog(env.DB, { accountId, action: 'send', to: m.to, subject: m.subject, gmailId: r.gmailId, ok: true, error: '' });
    return { ok: true as const, gmailId: r.gmailId };
  } catch (e: any) {
    await store.addLog(env.DB, { accountId, action: 'send', to: m.to, subject: m.subject, gmailId: '', ok: false, error: e?.message ?? 'send failed' });
    throw e;
  }
}

export async function saveDraft(env: EmailEnv, accountId: string, input: Partial<ComposeInput>) {
  const m = validateCompose(input);
  const acc = await activeAccount(env, accountId);
  const { access, from } = await getAccessToken(env, accountId);
  const raw = buildRawMessage(from || acc.email, m);
  const r = await gmailProvider.createDraftRaw(access, raw);
  await store.addLog(env.DB, { accountId, action: 'draft', to: m.to, subject: m.subject, gmailId: r.draftId, ok: true, error: '' });
  return { ok: true as const, draftId: r.draftId };
}

export async function listDrafts(env: EmailEnv, accountId: string, max?: number): Promise<DraftSummary[]> {
  await activeAccount(env, accountId);
  const { access } = await getAccessToken(env, accountId);
  return gmailProvider.listDrafts(access, max);
}

export async function deleteDraft(env: EmailEnv, accountId: string, draftId: string): Promise<void> {
  await activeAccount(env, accountId);
  const { access } = await getAccessToken(env, accountId);
  await gmailProvider.deleteDraft(access, draftId);
}

export async function disconnect(env: EmailEnv, accountId: string): Promise<void> {
  await env.tokens.delete(oauthKey(accountId));
  await store.setAccountStatus(env.DB, accountId, 'revoked');
}

/** Queue a one-shot (sendAt ISO) or daily-repeat (repeatDailyAt "HH:MM" IST) mail. */
export async function scheduleMail(env: EmailEnv, accountId: string, input: Partial<ComposeInput>, opts: {
  sendAt?: string; repeatDailyAt?: string;
}) {
  const m = validateCompose(input);
  await activeAccount(env, accountId);
  const now = Date.now();
  let dueAt = now;
  let repeat = '';
  if (opts.repeatDailyAt) {
    repeat = String(opts.repeatDailyAt).trim();
    dueAt = nextDailyDueIst(repeat, now);
  } else if (opts.sendAt) {
    dueAt = new Date(String(opts.sendAt)).getTime();
    if (!Number.isFinite(dueAt)) throw new Error('sendAt must be an ISO datetime');
    if (dueAt <= now - 60_000) throw new Error('sendAt is in the past');
  }
  return store.enqueue(env.DB, accountId, m, dueAt, repeat);
}

/** Per-minute cron tick: send everything due. Best-effort — never throws. */
export async function processDueEmails(env: EmailEnv): Promise<{ checked: number; sent: number; failed: number }> {
  const out = { checked: 0, sent: 0, failed: 0 };
  try {
    const due = await store.claimDue(env.DB, Date.now(), 10);
    out.checked = due.length;
    for (const item of due) {
      try {
        const acc = await store.getAccount(env.DB, item.accountId);
        if (!acc || acc.status !== 'active') throw new Error('account missing or revoked');
        const { access, from } = await getAccessToken(env, item.accountId);
        const raw = buildRawMessage(from || acc.email, item);
        const r = await gmailProvider.sendRaw(access, raw);
        const next = item.repeatDailyAt ? nextDailyDueIst(item.repeatDailyAt, Date.now()) : null;
        await store.resolveOutbox(env.DB, item.id, true, '', next);
        await store.addLog(env.DB, {
          accountId: item.accountId, action: item.repeatDailyAt ? 'cron-daily' : 'scheduled',
          to: item.to, subject: item.subject, gmailId: r.gmailId, ok: true, error: '',
        });
        out.sent++;
      } catch (e: any) {
        await store.resolveOutbox(env.DB, item.id, false, e?.message ?? 'send failed', null);
        await store.addLog(env.DB, {
          accountId: item.accountId, action: 'scheduled', to: item.to,
          subject: item.subject, gmailId: '', ok: false, error: e?.message ?? 'send failed',
        });
        out.failed++;
      }
    }
    if (out.checked > 0) console.log(`[cron] email-outbox checked=${out.checked} sent=${out.sent} failed=${out.failed}`);
  } catch (e: any) {
    console.error('[cron] email-outbox tick failed:', e?.message);
  }
  return out;
}

export async function statusSnapshot(env: EmailEnv) {
  const accounts = await store.listAccounts(env.DB);
  const withConn = await Promise.all(accounts.map(async (a) => ({
    ...a, connected: !!(await env.tokens.get(oauthKey(a.id)).catch(() => null)),
  })));
  const outbox = await store.listOutbox(env.DB, 20);
  const queued = outbox.filter((o) => o.status === 'queued').length;
  return { accounts: withConn, outbox, queued };
}
