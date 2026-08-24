import { Router } from 'express';
import { prisma } from '../shared/prisma';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.get('/', asyncHandler(async (_req, res) => {
  const tcs = await prisma.telecaller.findMany({ orderBy: { order: 'asc' } });
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

router.post('/', asyncHandler(async (req, res) => {
  const { name, email, active, order } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const tc = await prisma.telecaller.create({
    data: { name: String(name).trim(), email: email ?? null, active: active ?? true, order: order ?? 0 },
  });
  return res.status(201).json(tc);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { name, email, active, order } = req.body || {};
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = String(name).trim();
  if (email !== undefined) data.email = email;
  if (active !== undefined) data.active = active;
  if (order !== undefined) data.order = order;
  const tc = await prisma.telecaller.update({ where: { id: String(req.params.id) }, data });
  res.json(tc);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.telecaller.delete({ where: { id: String(req.params.id) } });
  res.json({ ok: true });
}));

export default router;
