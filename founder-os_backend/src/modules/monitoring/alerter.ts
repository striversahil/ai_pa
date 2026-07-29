import { config } from '../../config';
import { logger } from '../../shared/logger';

export class Alerter {
  static async alert(message: string, severity: 'warning' | 'critical') {
    logger[severity === 'critical' ? 'error' : 'warn']({ alert: message });

    if (config.SLACK_WEBHOOK_URL) {
      try {
        await fetch(config.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `[${severity.toUpperCase()}] WhatsApp SLA: ${message}`,
          }),
        });
      } catch (err: any) {
        logger.error({ error: err.message }, 'Failed to send Slack alert');
      }
    }
  }
}