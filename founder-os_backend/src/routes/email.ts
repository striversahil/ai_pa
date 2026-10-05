// routes/email.ts (Express alternate runtime) — stateless mirror of the
// Worker /api/email/* endpoints. Tokens come from env (GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN); there is no D1/KV here, so
// /schedule (which needs the persisted outbox + cron tick) returns 501 and
// points at the Worker runtime, which is the production path.
import { Router } from 'express';
import { gmailProvider, redirectUri } from '../automations/email/gmail';
import { buildRawMessage, validateCompose } from '../automations/email/types';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

function creds() {
  const id = String(process.env.GOOGLE_CLIENT_ID ?? '');
  const secret = String(process.env.GOOGLE_CLIENT_SECRET ?? '');
  const refresh = String(process.env.GOOGLE_REFRESH_TOKEN ?? '');
  if (!id || !secret || !refresh) throw new Error('GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN not set');
  return { id, secret, refresh };
}

let cached: { access: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.exp - Date.now() > 5 * 60_000) return cached.access;
  const { id, secret, refresh } = creds();
  const t = await gmailProvider.refreshAccessToken({ clientId: id, clientSecret: secret, refreshToken: refresh });
  cached = { access: t.accessToken, exp: Date.now() + t.expiresIn * 1000 };
  return cached.access;
}

async function fromAddr(access: string): Promise<string> {
  return (await gmailProvider.getProfile(access)).email;
}

router.get('/status', asyncHandler(async (_req, res) => {
  try {
    const access = await accessToken();
    res.status(200).json({ ok: true, runtime: 'express', connected: true, email: await fromAddr(access) });
  } catch (e: any) {
    res.status(200).json({ ok: true, runtime: 'express', connected: false, error: e?.message });
  }
}));

router.get('/oauth/start', asyncHandler(async (req, res) => {
  const id = String(process.env.GOOGLE_CLIENT_ID ?? '');
  if (!id) { res.status(500).json({ ok: false, error: 'GOOGLE_CLIENT_ID not set' }); return; }
  const origin = String(process.env.PUBLIC_ORIGIN ?? 'http://localhost:3000');
  const state = String(req.query.account ?? 'express');
  res.redirect(gmailProvider.oauthStartUrl({ clientId: id, redirectUri: redirectUri(origin), state }));
}));

router.post('/send', asyncHandler(async (req, res) => {
  try {
    const m = validateCompose(req.body);
    const access = await accessToken();
    const r = await gmailProvider.sendRaw(access, buildRawMessage(await fromAddr(access), m));
    res.status(200).json({ ok: true, gmailId: r.gmailId });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message ?? 'send failed' });
  }
}));

router.post('/draft', asyncHandler(async (req, res) => {
  try {
    const m = validateCompose(req.body);
    const access = await accessToken();
    const r = await gmailProvider.createDraftRaw(access, buildRawMessage(await fromAddr(access), m));
    res.status(200).json({ ok: true, draftId: r.draftId });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message ?? 'draft failed' });
  }
}));

router.get('/drafts', asyncHandler(async (req, res) => {
  try {
    const drafts = await gmailProvider.listDrafts(await accessToken(), Number(req.query.max ?? 20));
    res.status(200).json({ ok: true, drafts });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message ?? 'drafts failed' });
  }
}));

router.delete('/draft', asyncHandler(async (req, res) => {
  try {
    await gmailProvider.deleteDraft(await accessToken(), String(req.query.draftId ?? ''));
    res.status(200).json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message ?? 'delete failed' });
  }
}));

// No persisted outbox on this runtime — the Worker cron tick owns scheduling.
router.post('/schedule', asyncHandler(async (_req, res) => {
  res.status(501).json({ ok: false, error: 'scheduled mail needs the Worker runtime (D1 outbox + cron tick) — use POST /api/email/schedule on the worker' });
}));

export default router;
