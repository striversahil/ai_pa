import { Router } from 'express';
import { prisma } from '../shared/prisma';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const estimates = await prisma.estimate.findMany({
    where: { OR: [{ status: 'sent' }, { status: 'accepted' }, { status: 'declined' }, { status: 'confirmed' }] },
    include: { classification: true, comments: { orderBy: { commentId: 'desc' } } }
  });
  res.status(200).json(estimates);
}));

export default router;