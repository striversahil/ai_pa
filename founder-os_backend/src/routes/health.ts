import { Router } from 'express';
import { buildHealthPayload } from '../modules/monitoring/health';

const router = Router();

router.get('/', async (_req, res) => {
  res.json(await buildHealthPayload());
});

router.get('/whatsapp', async (_req, res) => {
  res.json(await buildHealthPayload());
});

export default router;
