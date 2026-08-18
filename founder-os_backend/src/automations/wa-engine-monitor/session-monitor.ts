import { logger } from '../../shared/logger';
import { AuditService } from '../../modules/audit/service';
import { refreshWaEngineCache } from '../../modules/whatsapp/wa-engine-cache';
import type { WaEngineSessionInfo } from '../../modules/whatsapp/session-status';

// Track WA Engine Pro connection state for hygiene monitoring
let lastWaEngineStatus = 'unknown';
let waEngineDisconnectedSince: Date | null = null;

/**
 * Checks WA Engine Pro connectivity (GET /me via the API key) and flags
 * sustained unreachability. Runs every 5 minutes from the WhatsApp cron
 * registrar. The live snapshot + health payload are written into the in-memory
 * cache on each tick so the dashboard can serve them without issuing its own
 * WA Engine calls. (WA Engine Pro is a cloud SaaS — there is no local session
 * to reconnect; this only monitors and audits connectivity.)
 */
export async function checkWaEngineSession(): Promise<void> {
  let sessionInfo: WaEngineSessionInfo;
  try {
    sessionInfo = (await refreshWaEngineCache()).sessionInfo;
  } catch (e) {
    logger.error({ err: e }, 'WA Engine cache refresh failed');
    return;
  }

  // WA Engine API answered (reachable), but returned a non-2xx status code.
  if (sessionInfo.reachable && sessionInfo.status.startsWith('http_')) {
    logger.warn({ status: sessionInfo.status }, 'WA Engine Pro check returned non-OK');
    lastWaEngineStatus = 'error';
    return;
  }

  // WA Engine API itself is unreachable.
  if (!sessionInfo.reachable) {
    if (lastWaEngineStatus !== 'unreachable') {
      logger.error('WA Engine Pro is unreachable');
      waEngineDisconnectedSince = waEngineDisconnectedSince || new Date();
      AuditService.record('WA_ENGINE_DISCONNECTED', 'SESSION', null, { status: 'unreachable' }).catch(() => {});
    }
    lastWaEngineStatus = 'unreachable';
    return;
  }

  const status = sessionInfo.status || 'unknown';
  if (status !== 'WORKING') {
    if (lastWaEngineStatus === 'WORKING') {
      waEngineDisconnectedSince = new Date();
      logger.warn({ status }, 'WA Engine Pro connectivity lost');
      AuditService.record('WA_ENGINE_DISCONNECTED', 'SESSION', null, { status, since: waEngineDisconnectedSince.toISOString() }).catch(() => {});
    }
  } else {
    if (lastWaEngineStatus !== 'WORKING' && lastWaEngineStatus !== 'unknown') {
      logger.info('WA Engine Pro connectivity restored');
      waEngineDisconnectedSince = null;
      AuditService.record('WA_ENGINE_RECONNECT', 'SESSION', null, {}).catch(() => {});
    }
    waEngineDisconnectedSince = null;
  }
  lastWaEngineStatus = status;
}
