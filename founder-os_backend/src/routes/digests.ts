import { Router } from 'express';
import { DigestService } from '../modules/digest/service';
import { processMessagesToDigests } from '../automations/whatsapp-digest/process';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  let digests = await DigestService.fetchAllDigests();
  if (digests.length === 0) {
    await processMessagesToDigests();
    digests = await DigestService.fetchAllDigests();
  }
  res.status(200).json(digests);
}));

export default router;
