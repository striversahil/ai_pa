import { Router } from 'express';
import { config } from '../config';
import { useInMemoryDb } from '../shared/prisma';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const isMockLLM = !config.LLM_API_KEY || config.LLM_API_KEY === 'your_api_key_here';
  res.status(200).json({ success: true, useInMemoryDb, isMockLLM });
}));

export default router;
