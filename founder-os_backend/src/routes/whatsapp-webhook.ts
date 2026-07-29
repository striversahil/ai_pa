import { Router } from 'express';
import { WhatsAppController } from '../modules/whatsapp/controller';

const router = Router();

router.post('/', WhatsAppController.handleWebhook);

export default router;
