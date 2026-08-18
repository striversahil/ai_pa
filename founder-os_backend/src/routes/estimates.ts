import { Router } from 'express';
import { prisma } from '../shared/prisma';
import { asyncHandler } from '../middleware/asyncHandler';
import { isSystemGeneratedComment } from '../shared/systemComment';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const [estimates, lastCompleteSync] = await Promise.all([
    prisma.estimate.findMany({
      where: { OR: [{ status: 'sent' }, { status: 'accepted' }, { status: 'declined' }, { status: 'confirmed' }] },
      include: { classification: true, comments: { orderBy: { commentId: 'desc' } } }
    }),
    prisma.setting.findUnique({ where: { key: 'sales_copilot:last_complete_sync_at' } }),
  ]);
  // Zoho auto-logged comments ("Quote marked as sent", "Quote updated. Amount changed
  // from X to Y", ...) carry no sales intent and must not reach the UI timeline or
  // any comment counts. Filter them out of the payload.
  const estimatesWithRealComments = estimates.map(e => ({
    ...e,
    comments: (e.comments || []).filter(c => !isSystemGeneratedComment(c.description, c.commentedBy))
  }));
  res.status(200).json({
    estimates: estimatesWithRealComments,
    lastCompleteSyncAt: lastCompleteSync?.value ? lastCompleteSync.value : null
  });
}));

export default router;