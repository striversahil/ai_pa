import { Router } from 'express';
import { prisma } from '../shared/prisma';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireScope, getMe } from '../modules/auth/service';
import { AuthError } from '../modules/auth/types';
import { PrismaAuthStore } from '../modules/auth/store-prisma';
import {
  listAccountants, createAccountant, updateAccountant,
  listTemplates, createTemplate, updateTemplate, logTask, getAccountsExport,
} from '../automations/accounts/service';

void prisma;

const router = Router();
const store = new PrismaAuthStore(prisma);
const misGuard = asyncHandler(async (req, res, next) => {
  try {
    await requireScope(store as any, req.headers.cookie || null, 'mis');
    next();
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

router.get('/roster', misGuard, asyncHandler(async (req, res) => {
  res.json({ accountants: await listAccountants(req.query.deleted === '1') });
}));
router.post('/roster', misGuard, asyncHandler(async (req, res) => {
  try { res.status(201).json(await createAccountant(req.body || {})); }
  catch (e: any) { res.status(400).json({ error: e?.message ?? 'create failed' }); }
}));
router.put('/roster/:id', misGuard, asyncHandler(async (req, res) => {
  try { res.json(await updateAccountant(String(req.params.id), req.body || {})); }
  catch (e: any) { res.status(400).json({ error: e?.message ?? 'update failed' }); }
}));
router.delete('/roster/:id', misGuard, asyncHandler(async (req, res) => {
  await updateAccountant(String(req.params.id), { deleted: true });
  res.json({ ok: true });
}));

router.get('/templates', misGuard, asyncHandler(async (req, res) => {
  res.json({ templates: await listTemplates(req.query.all === '1') });
}));
router.post('/templates', misGuard, asyncHandler(async (req, res) => {
  try { res.status(201).json(await createTemplate(req.body || {})); }
  catch (e: any) { res.status(400).json({ error: e?.message ?? 'create failed' }); }
}));
router.put('/templates/:id', misGuard, asyncHandler(async (req, res) => {
  try { res.json(await updateTemplate(String(req.params.id), req.body || {})); }
  catch (e: any) { res.status(400).json({ error: e?.message ?? 'update failed' }); }
}));
router.delete('/templates/:id', misGuard, asyncHandler(async (req, res) => {
  await updateTemplate(String(req.params.id), { active: false });
  res.json({ ok: true });
}));

router.get('/export', misGuard, asyncHandler(async (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  try { res.json(await getAccountsExport(req.query.days, origin, req.query.from, req.query.to)); }
  catch (e: any) { res.status(400).json({ error: e?.message ?? 'export failed' }); }
}));

router.patch('/logs/:id', asyncHandler(async (req, res) => {
  const me = await getMe(store as any, req.headers.cookie || null).catch(() => null);
  const actor = (me as any)?.user?.name ?? (me as any)?.user?.email ?? null;
  try { res.json(await logTask(String(req.params.id), req.body || {}, actor)); }
  catch (e: any) { res.status(400).json({ error: e?.message ?? 'log failed' }); }
}));

// Proof-file bytes live in Workers KV — worker-only runtime (mirrors CRM).
router.post('/logs/:id/files', (_req, res) => res.status(501).json({ error: 'Account file upload is only available on the Cloudflare Worker runtime' }));
router.get('/files/:id', (_req, res) => res.status(501).json({ error: 'Account file serving is only available on the Cloudflare Worker runtime' }));
router.delete('/files/:id', (_req, res) => res.status(501).json({ error: 'Account file delete is only available on the Cloudflare Worker runtime' }));

export default router;
