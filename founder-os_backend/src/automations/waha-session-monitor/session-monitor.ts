import { config } from '../../config';
import { logger } from '../../shared/logger';
import { AuditService } from '../../modules/audit/service';
import { refreshWahaCache } from '../../modules/whatsapp/waha-cache';
import type { WahaSessionInfo } from '../../modules/whatsapp/session-status';

// Track WAHA connection state for hygiene monitoring
let lastWahaStatus = 'unknown';
let wahaDisconnectedSince: Date | null = null;

/**
 * Checks the WAHA session status and auto-reconnects if it has been
 * disconnected for more than a minute. Runs every 5 minutes from the
 * WhatsApp cron registrar. The live session snapshot + health payload are
 * written into the in-memory WAHA cache on each tick so the dashboard can
 * serve them without issuing its own WAHA calls.
 */
export async function checkWahaSession(): Promise<void> {
  let sessionInfo: WahaSessionInfo;
  try {
    sessionInfo = (await refreshWahaCache()).sessionInfo;
  } catch (e) {
    logger.error({ err: e }, 'WAHA cache refresh failed');
    return;
  }

  // WAHA API answered (reachable), but returned a non-2xx status code.
  if (sessionInfo.reachable && sessionInfo.status.startsWith('http_')) {
    logger.warn({ status: sessionInfo.status }, 'WAHA session check returned non-OK');
    lastWahaStatus = 'error';
    return;
  }

  // WAHA API itself is unreachable.
  if (!sessionInfo.reachable) {
    if (lastWahaStatus !== 'unreachable') {
      logger.error('WAHA is unreachable');
      wahaDisconnectedSince = wahaDisconnectedSince || new Date();
      AuditService.record('WAHA_DISCONNECTED', 'SESSION', null, { status: 'unreachable' }).catch(() => {});
    }
    lastWahaStatus = 'unreachable';
    return;
  }

  const status = sessionInfo.status || 'unknown';
  if (status !== 'WORKING') {
    if (lastWahaStatus === 'WORKING') {
      wahaDisconnectedSince = new Date();
      logger.warn({ wahaStatus: status }, 'WAHA session lost, will attempt reconnect');
      AuditService.record('WAHA_DISCONNECTED', 'SESSION', null, { status, since: wahaDisconnectedSince.toISOString() }).catch(() => {});
    }
    if (wahaDisconnectedSince && Date.now() - wahaDisconnectedSince.getTime() > 60_000) {
      logger.info('WAHA session disconnected >1 min, attempting reconnect...');
      const startRes = await fetch(`${config.WAHA_API_URL}/api/sessions/${config.WAHA_SESSION_NAME}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': config.WAHA_API_KEY },
      });
      if (startRes.ok) {
        logger.info('WAHA session reconnected successfully');
        wahaDisconnectedSince = null;
        AuditService.record('WAHA_RECONNECT', 'SESSION', null, {}).catch(() => {});
      }
    }
  } else {
    if (lastWahaStatus !== 'WORKING' && lastWahaStatus !== 'unknown') {
      logger.info('WAHA session restored to WORKING');
      wahaDisconnectedSince = null;
      AuditService.record('WAHA_RECONNECT', 'SESSION', null, {}).catch(() => {});
    }
    wahaDisconnectedSince = null;
  }
  lastWahaStatus = status;
}
