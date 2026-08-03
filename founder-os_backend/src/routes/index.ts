import { Router } from 'express';
import statusRouter from './status';
import briefRouter from './brief';
import digestsRouter from './digests';
import tasksRouter from './tasks';
import messagesRouter from './messages';
import sheetDataRouter from './sheet-data';
import brainRouter from './brain';
import estimatesRouter from './estimates';
import triggersRouter from './triggers';
import whatsappProxyRouter from './whatsapp-proxy';
import whatsappWebhookRouter from './whatsapp-webhook';
import healthRouter from './health';
import { BrainService } from '../modules/brain/service';
import { SalesCopilotService } from '../automations/zoho-sent-analyzer/service';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.use('/status', statusRouter);
router.use('/brief', briefRouter);
router.use('/digests', digestsRouter);
router.use('/tasks', tasksRouter);
router.use('/messages', messagesRouter);
router.use('/sheet-data', sheetDataRouter);
router.use('/brain', brainRouter);
router.use('/estimates', estimatesRouter);
router.use('/trigger', triggersRouter);
router.use('/whatsapp', whatsappProxyRouter);
router.use('/health', healthRouter);

// Backward-compatible aliases for moved routes
router.post('/ask-founder-ai', asyncHandler(async (req, res) => {
  const { entityFilter } = req.body;
  const question = req.body.question;
  if (!question) { res.status(400).json({ error: 'Missing question in request body' }); return; }
  const result = await BrainService.query(question, entityFilter);
  res.status(200).json({ question, answer: result.answer, brainMeta: { sourcesUsed: result.sourcesUsed, contextCount: result.contextCount } });
}));

router.post('/trigger/sales-sync', asyncHandler(async (req, res) => {
  const force = req.query.force === 'true' || req.body?.force === true;
  const result = await new SalesCopilotService().runSync(force);
  res.status(200).json({ message: 'Sales Copilot analysis job completed', result });
}));

export default router;
export { whatsappWebhookRouter };
