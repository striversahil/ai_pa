import { Router, Request, Response, NextFunction } from 'express';
import ipaddr from 'ipaddr.js';
import { WhatsAppController } from '../modules/whatsapp/controller';
import { asyncHandler } from '../utils/asyncHandler';
import { logger } from '../shared/logger';

const router = Router();

const WAHA_ALLOWED_IPS = [
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.1/32',
  '::1/128',
];

function ipAllowlist(req: Request, res: Response, next: NextFunction) {
  const clientIp = req.ip || req.socket.remoteAddress || '';
  try {
    const addr = ipaddr.parse(clientIp);
    const allowed = WAHA_ALLOWED_IPS.some(range => {
      try {
        const [rangeAddr, prefix] = ipaddr.parseCIDR(range);
        return addr.match(rangeAddr, prefix);
      }
      catch { return false; }
    });
    if (!allowed) {
      logger.warn({ ip: clientIp }, 'Rejected webhook from unauthorized IP');
      return res.status(403).json({ error: 'Forbidden' });
    }
  } catch {
    logger.warn({ ip: clientIp }, 'Could not parse webhook client IP');
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

router.post('/', ipAllowlist, asyncHandler(WhatsAppController.handleWebhook));

export default router;
