import { Router } from 'express';
import { prisma } from '../shared/prisma';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireScope } from '../modules/auth/service';
import { AuthError } from '../modules/auth/types';
import { PrismaAuthStore } from '../modules/auth/store-prisma';

const router = Router();

// MIS-level control: the roster is the assignment controller — every roster
// read/write requires the `mis` scope (or root/admin).
const misAuthStore = new PrismaAuthStore(prisma);
const misGuard = asyncHandler(async (req, res, next) => {
  try {
    await requireScope(misAuthStore as any, req.headers.cookie || null, 'mis');
    next();
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

router.get('/', misGuard, asyncHandler(async (req, res) => {
  const showDeleted = req.query.deleted === '1';
  const tcs = await prisma.telecaller.findMany({ where: { deleted: showDeleted }, orderBy: { order: 'asc' } });
  const withCounts = await Promise.all(
    tcs.map(async (t) => {
      const [totalAssigned, activeAssigned] = await Promise.all([
        prisma.estimateAssignment.count({ where: { telecallerId: t.id } }),
        prisma.estimateAssignment.count({ where: { telecallerId: t.id, status: 'assigned' } }),
      ]);
      return { ...t, totalAssigned, activeAssigned };
    }),
  );
  res.json({ telecallers: withCounts });
}));

router.post('/', misGuard, asyncHandler(async (req, res) => {
  const { name, email, assignEstimateFollowUps, order } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const tc = await prisma.telecaller.create({
    data: { name: String(name).trim(), email: email ?? null, assignEstimateFollowUps: assignEstimateFollowUps ?? true, order: order ?? 0 },
  });
  return res.status(201).json(tc);
}));

router.put('/:id', misGuard, asyncHandler(async (req, res) => {
  const { name, email, assignEstimateFollowUps, order, deleted, neodoveUserId, neodoveUserName } = req.body || {};
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = String(name).trim();
  if (email !== undefined) data.email = email;
  if (assignEstimateFollowUps !== undefined) data.assignEstimateFollowUps = assignEstimateFollowUps;
  if (order !== undefined) data.order = order;
  if (neodoveUserId !== undefined) data.neodoveUserId = neodoveUserId;
  if (neodoveUserName !== undefined) data.neodoveUserName = neodoveUserName;
  if (deleted !== undefined) {
    data.deleted = !!deleted;
    if (deleted === false && assignEstimateFollowUps === undefined) data.assignEstimateFollowUps = false; // restore comes back without follow-up flag
  }
  const tc = await prisma.telecaller.update({ where: { id: String(req.params.id) }, data });
  res.json(tc);
}));

router.delete('/:id', misGuard, asyncHandler(async (req, res) => {
  // Soft delete: hidden everywhere, restorable from the MIS Controller.
  await prisma.telecaller.update({
    where: { id: String(req.params.id) },
    data: { deleted: true, assignEstimateFollowUps: false },
  });
  res.json({ ok: true });
}));

export default router;
