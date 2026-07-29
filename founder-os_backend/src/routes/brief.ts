import { Router } from 'express';
import { StorageRepository } from '../modules/storage/repository';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';

const router = Router();

router.get('/latest', asyncHandler(async (req, res) => {
  const brief = await StorageRepository.fetchLatestFounderNote();
  if (!brief) throw new AppError('No briefings found.', 404);
  res.status(200).json(brief);
}));

export default router;
