import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { WhatsAppController } from '../modules/whatsapp/controller';

const router = Router();

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  message: { error: 'Too many webhook requests' },
});

router.post('/', webhookLimiter, WhatsAppController.handleWebhook);

export default router;