import { Router } from 'express';
import { WhatsAppService } from '../modules/whatsapp/service';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.get('/:chatId', asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const messages = await WhatsAppService.fetchMessagesByChatId(chatId);
  res.status(200).json(messages);
}));

export default router;
