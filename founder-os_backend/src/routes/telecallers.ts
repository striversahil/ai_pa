import { Router } from 'express';
import { prisma } from '../shared/prisma';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireScope } from '../modules/auth/service';
import { AuthError } from '../modules/auth/types';
import { PrismaAuthStore } from '../modules/auth/store-prisma';
// Region-model mirror of the Worker roster routes. The penalty toggles,
// EOD-reassignment switch and the absent/present cover flow are retired
// (founder decision 2026-10-22) and removed here.
import { isValidRegion, isValidTlLevel } from '../automations/telecalling/service';

const router = Router();

// MIS-level control: the roster is the region/hierarchy map — every roster
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
  const { name, email, assignEstimateFollowUps, order, tlLevel, region, phone, whatsapp, type } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  if (type !== undefined && type !== 'telecaller' && type !== 'field_staff') return res.status(400).json({ error: "type must be 'telecaller' or 'field_staff'" });
  if (tlLevel !== undefined && !isValidTlLevel(tlLevel)) return res.status(400).json({ error: 'tlLevel must be TL1 or TL2 (or unset)' });
  if (region !== undefined && !isValidRegion(region)) return res.status(400).json({ error: 'region must be R1–R4 (or unset)' });
  const tc = await prisma.telecaller.create({
    data: {
      name: String(name).trim(),
      email: email ?? null,
      phone: phone ?? null,
      whatsapp: whatsapp ?? null,
      tlLevel: tlLevel ?? '',
      region: region ?? '',
      type: type === 'field_staff' ? 'field_staff' : 'telecaller',
      // Field staff never close — they only generate leads.
      assignEstimateFollowUps: type === 'field_staff' ? false : (assignEstimateFollowUps ?? true),
      order: order ?? 0,
    },
  });
  return res.status(201).json(tc);
}));

router.put('/:id', misGuard, asyncHandler(async (req, res) => {
  const { name, email, assignEstimateFollowUps, order, deleted, neodoveUserId, neodoveUserName, tlLevel, region, phone, whatsapp, type } = req.body || {};
  const data: Record<string, unknown> = {};
  if (type !== undefined) {
    if (type !== 'telecaller' && type !== 'field_staff') return res.status(400).json({ error: "type must be 'telecaller' or 'field_staff'" });
    data.type = type;
  }
  if (name !== undefined) data.name = String(name).trim();
  if (email !== undefined) data.email = email;
  if (phone !== undefined) data.phone = phone;
  if (whatsapp !== undefined) data.whatsapp = whatsapp;
  if (assignEstimateFollowUps !== undefined) data.assignEstimateFollowUps = assignEstimateFollowUps;
  if (data.type === 'field_staff') data.assignEstimateFollowUps = false;
  if (order !== undefined) data.order = order;
  if (neodoveUserId !== undefined) data.neodoveUserId = neodoveUserId;
  if (neodoveUserName !== undefined) data.neodoveUserName = neodoveUserName;
  if (tlLevel !== undefined) {
    if (!isValidTlLevel(tlLevel)) return res.status(400).json({ error: 'tlLevel must be TL1 or TL2 (or unset)' });
    data.tlLevel = tlLevel;
  }
  if (region !== undefined) {
    if (!isValidRegion(region)) return res.status(400).json({ error: 'region must be R1–R4 (or unset)' });
    data.region = region;
  }
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
