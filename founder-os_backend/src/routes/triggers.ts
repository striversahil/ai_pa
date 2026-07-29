import { Router } from 'express';
import { DigestService } from '../modules/digest/service';
import { EmailService } from '../modules/email/service';
import { SchedulerService } from '../modules/scheduler/service';
import { BrainService } from '../modules/brain/service';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.post('/digest', asyncHandler(async (req, res) => {
  const result = await DigestService.processMessagesToDigests();
  res.status(200).json({ message: 'Digest job triggered successfully', result });
}));

router.post('/email-sync', asyncHandler(async (req, res) => {
  const count = await EmailService.syncEmails();
  res.status(200).json({ message: 'Email sync job completed', emailsSynced: count });
}));

router.post('/briefing', asyncHandler(async (req, res) => {
  const brief = await SchedulerService.generateAndSaveMorningBrief();
  res.status(200).json({ message: 'Morning briefing generated and saved', brief });
}));

router.post('/summary', asyncHandler(async (req, res) => {
  const summary = await SchedulerService.generateAndSaveEveningSummary();
  res.status(200).json({ message: 'Evening summary generated and saved', summary });
}));

router.post('/brain-index', asyncHandler(async (req, res) => {
  const brain = new BrainService();
  const result = await brain.runSync();
  res.status(200).json({ message: 'Company Brain re-index complete', result });
}));

export default router;
