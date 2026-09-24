import { Router } from 'express';
import { prisma } from '../shared/prisma';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireScope } from '../modules/auth/service';
import { AuthError } from '../modules/auth/types';
import { PrismaAuthStore } from '../modules/auth/store-prisma';
import {
  createProduct, updateProduct, deleteProduct,
  createGuide, updateGuide, deleteGuide,
  createVendor, updateVendor, deleteVendor,
  createRate, updateRate, setRateActive,
} from '../automations/product-line/update';

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
/** Quote writes: whoever holds the `product-line` scope (Admin panel grant),
 *  plus MIS/admin. Products/guide/vendors stay MIS-only. */
const quoteGuard = asyncHandler(async (req, res, next) => {
  try {
    await requireScope(store as any, req.headers.cookie || null, 'product-line');
    return next();
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
  }
  try {
    await requireScope(store as any, req.headers.cookie || null, 'mis');
    next();
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

const writeError = (res: any, e: any) => {
  const msg = String(e?.message ?? 'write failed');
  if (/already exists/i.test(msg)) return res.status(409).json({ error: msg.slice(0, 300) });
  const nn = msg.match(/NOT NULL constraint failed:\s*[\w"]+\.([\w"]+)/i);
  if (nn) return res.status(400).json({ error: `${nn[1]} is required` });
  const uq = msg.match(/UNIQUE constraint failed:\s*[\w"]+\.([\w"]+)/i);
  if (uq) return res.status(409).json({ error: `this ${uq[1]} already exists` });
  if (/no such table|no such column/i.test(msg)) return res.status(503).json({ error: 'database not ready — try again in a minute' });
  res.status(400).json({ error: 'could not save — check the fields and retry' });
};

router.get('/products/:id', asyncHandler(async (req, res) => {
  try {
    const { getProductDetail } = await import('../automations/product-line/service');
    res.json(await getProductDetail(String(req.params.id)));
  } catch (e: any) {
    res.status(404).json({ error: String(e?.message ?? 'not found').slice(0, 300) });
  }
}));

router.get('/photos', (_req, res) => res.status(501).json({ error: 'Photo storage is only available on the Cloudflare Worker runtime' }));
router.post('/photos', (_req, res) => res.status(501).json({ error: 'Photo upload is only available on the Cloudflare Worker runtime' }));

router.post('/products', misGuard, asyncHandler(async (req, res) => {
  try { res.status(201).json(await createProduct(req.body || {})); }
  catch (e: any) { writeError(res, e); }
}));
router.patch('/products/:id', misGuard, asyncHandler(async (req, res) => {
  try { res.json(await updateProduct(String(req.params.id), req.body || {})); }
  catch (e: any) { writeError(res, e); }
}));
router.delete('/products/:id', misGuard, asyncHandler(async (req, res) => {
  try { res.json(await deleteProduct(String(req.params.id))); }
  catch (e: any) { writeError(res, e); }
}));
router.post('/guide', misGuard, asyncHandler(async (req, res) => {
  try { res.status(201).json(await createGuide(req.body || {})); }
  catch (e: any) { writeError(res, e); }
}));
router.patch('/guide/:id', misGuard, asyncHandler(async (req, res) => {
  try { res.json(await updateGuide(String(req.params.id), req.body || {})); }
  catch (e: any) { writeError(res, e); }
}));
router.delete('/guide/:id', misGuard, asyncHandler(async (req, res) => {
  try { res.json(await deleteGuide(String(req.params.id))); }
  catch (e: any) { writeError(res, e); }
}));
router.post('/vendors', misGuard, asyncHandler(async (req, res) => {
  try { res.status(201).json(await createVendor(req.body || {})); }
  catch (e: any) { writeError(res, e); }
}));
router.patch('/vendors/:id', misGuard, asyncHandler(async (req, res) => {
  try { res.json(await updateVendor(String(req.params.id), req.body || {})); }
  catch (e: any) { writeError(res, e); }
}));
router.delete('/vendors/:id', misGuard, asyncHandler(async (req, res) => {
  try { res.json(await deleteVendor(String(req.params.id))); }
  catch (e: any) { writeError(res, e); }
}));
router.post('/rates', quoteGuard, asyncHandler(async (req, res) => {
  try { res.status(201).json(await createRate(req.body || {})); }
  catch (e: any) { writeError(res, e); }
}));
router.patch('/rates/:id', quoteGuard, asyncHandler(async (req, res) => {
  try {
    const body = (req.body || {}) as any;
    if (body?.active !== undefined && Object.keys(body).length === 1) {
      res.json(await setRateActive(String(req.params.id), body.active !== false));
    } else {
      res.json(await updateRate(String(req.params.id), body));
    }
  } catch (e: any) { writeError(res, e); }
}));

export default router;
