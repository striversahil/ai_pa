import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { getEstimatesPayload } from '../shared/estimates-cache';

const router = Router();

router.get('/', asyncHandler(async (_req, res) => {
  // Served from the 5-min estimates cache (Setting snapshot) — see
  // src/shared/estimates-cache.ts.
  const payload = await getEstimatesPayload();
  res.status(200).json(payload);
}));

export default router;