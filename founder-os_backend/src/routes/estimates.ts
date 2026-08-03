import { Router } from 'express';
import { prisma } from '../shared/prisma';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const [estimates, lastCompleteSync] = await Promise.all([
    prisma.estimate.findMany({
      where: { OR: [{ status: 'sent' }, { status: 'accepted' }, { status: 'declined' }, { status: 'confirmed' }] },
      include: { classification: true, comments: { orderBy: { commentId: 'desc' } } }
    }),
    prisma.setting.findUnique({ where: { key: 'sales_copilot:last_complete_sync_at' } }),
  ]);
  res.status(200).json({
    estimates,
    lastCompleteSyncAt: lastCompleteSync?.value ? lastCompleteSync.value : null
  });
}));

export default router;