import { config } from '../../config';
import { logger } from '../../shared/logger';
import { AuditService } from '../../modules/audit/service';

// Track WAHA connection state for hygiene monitoring
let lastWahaStatus = 'unknown';
let wahaDisconnectedSince: Date | null = null;

/**
 * Checks the WAHA session status and auto-reconnects if it has been
 * disconnected for more than a minute. Runs every 5 minutes from the
 * WhatsApp cron registrar.
 */
export async function checkWahaSession(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const sr = await fetch(`${config.WAHA_API_URL}/api/sessions/${config.WAHA_SESSION_NAME}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (sr.ok) {
      const sData = await sr.json();
      const status = sData.status || 'unknown';
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
    } else {
      logger.warn({ status: sr.status }, 'WAHA session check returned non-OK');
      lastWahaStatus = 'error';
    }
  } catch {
    if (lastWahaStatus !== 'unreachable') {
      logger.error('WAHA is unreachable');
      wahaDisconnectedSince = wahaDisconnectedSince || new Date();
      AuditService.record('WAHA_DISCONNECTED', 'SESSION', null, { status: 'unreachable' }).catch(() => {});
    }
    lastWahaStatus = 'unreachable';
  }
}
