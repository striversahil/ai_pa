import { Router, Request, Response, NextFunction } from 'express';
import ipaddr from 'ipaddr.js';
import { WhatsAppController } from '../modules/whatsapp/controller';
import { asyncHandler } from '../utils/asyncHandler';
import { config } from '../config';
import { logger } from '../shared/logger';

const router = Router();

// WA Engine Pro is a cloud service: its webhook POSTs come from public IPs, not
// localhost. Two admission paths:
//   1. Local/private sources (the webhook-relay, which always sits on the
//      Docker bridge) still pass the IP allowlist.
//   2. Cloud sources must present the WA_ENGINE_API_KEY in the X-Api-Key header
//      (WA Engine Pro signs outbound webhooks with the account key).
const PRIVATE_ALLOWED_IPS = [
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.1/32',
  '::1/128',
];

function isPrivateSource(clientIp: string): boolean {
  try {
    const addr = ipaddr.parse(clientIp);
    return PRIVATE_ALLOWED_IPS.some(range => {
      try {
        const [rangeAddr, prefix] = ipaddr.parseCIDR(range);
        return addr.match(rangeAddr, prefix);
      }
      catch { return false; }
    });
  } catch {
    return false;
  }
}

function authenticateWebhook(req: Request): boolean {
  const clientIp = req.ip || req.socket.remoteAddress || '';
  if (isPrivateSource(clientIp)) return true;
  const headerKey = req.header('X-Api-Key') || '';
  return headerKey === config.WA_ENGINE_API_KEY;
}

function webhookAuth(req: Request, res: Response, next: NextFunction) {
  if (!authenticateWebhook(req)) {
    const clientIp = req.ip || req.socket.remoteAddress || '';
    logger.warn({ ip: clientIp }, 'Rejected webhook from unauthorized source');
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

router.post('/', webhookAuth, asyncHandler(WhatsAppController.handleWebhook));

export default router;
