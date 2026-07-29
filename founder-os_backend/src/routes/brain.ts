import { Router } from 'express';
import { BrainService } from '../modules/brain/service';
import { asyncHandler } from '../middleware/asyncHandler';
import { AppError } from '../middleware/errorHandler';

const router = Router();

router.post('/query', asyncHandler(async (req, res) => {
  const { entityFilter } = req.body;
  const question = req.body.question;
  if (!question) throw new AppError('Missing question in request body', 400);
  const result = await BrainService.query(question, entityFilter);
  res.status(200).json(result);
}));

router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await BrainService.getStats();
  res.status(200).json(stats);
}));

export default router;