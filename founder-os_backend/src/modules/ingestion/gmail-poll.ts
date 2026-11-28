// gmail-poll.ts — the ONLY inbound poller (founder decision: every other
// provider is webhook-only; Gmail has no push, so it is read every 5 min).
//
// The manifest owns the interval and cursor field. Each enabled Gmail
// instance lists messages newer than its cursor, stages the raw Gmail
// message through the SAME hlp_ingested_data door as a webhook, and then
// advances the cursor. Staging is idempotent on the Gmail message id, so an
// overlapping window after a retry can never duplicate a row.

import { bindGatewayContext, call, resolveInstance } from '../integrations/gateway';
import type { GmailClient } from '../integrations/gateway/adapters/gmail';
import { listInstances, updateInstanceConfig } from '../integrations/gateway/store';
import { insertIngested } from './store';
import type { SqlDb } from './types';

const MAX_MESSAGES = 20;
const COLD_START_LOOKBACK_MS = 10 * 60 * 1000;

export interface PollSummary {
  instances: number;
  staged: number;
  duplicates: number;
  errors: string[];
}

function cursorOf(config: Record<string, unknown>): number {
  const raw = String(config.lastPollAt ?? '');
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : Date.now() - COLD_START_LOOKBACK_MS;
}

/** One 5-minute Gmail pass across every enabled instance. Never throws. */
export async function pollGmail(db: SqlDb, env: Record<string, unknown>): Promise<PollSummary> {
  const out: PollSummary = { instances: 0, staged: 0, duplicates: 0, errors: [] };
  bindGatewayContext({ db, env });
  let rows: Array<{ instanceKey: string }> = [];
  try {
    rows = (await listInstances(db)).filter((row) => row.provider === 'gmail' && row.enabled);
  } catch (e) {
    out.errors.push(`list instances: ${(e as Error).message}`);
    return out;
  }
  for (const row of rows) {
    out.instances += 1;
    try {
      const instance = await resolveInstance('gmail', { instanceKey: row.instanceKey });
      const client = await call<GmailClient>('gmail', { instanceKey: row.instanceKey });
      const startedAt = Date.now();
      const since = Math.floor(cursorOf(instance.config) / 1000) - 1;
      const query = [String(instance.config.labelFilter || 'in:inbox'), `after:${since}`].join(' ').trim();
      const messages = await client.listMessages(query, MAX_MESSAGES);
      for (const msg of messages.slice(0, MAX_MESSAGES)) {
        const id = String(msg?.id ?? '');
        if (!id) continue;
        const full = await client.getMessage(id, 'full');
        const staged = await insertIngested(db, {
          source: instance.instanceKey === 'default' ? 'gmail' : `gmail:${instance.instanceKey}`,
          instanceKey: instance.instanceKey,
          eventType: 'email',
          externalEventId: id,
          deliveryMode: instance.deliveryMode,
          rawPayload: JSON.stringify(full),
          headersJson: '{}',
        });
        if (staged.inserted) out.staged += 1;
        else out.duplicates += 1;
      }
      await updateInstanceConfig(db, instance.id, {
        ...instance.config,
        lastPollAt: new Date(startedAt).toISOString(),
      });
    } catch (e) {
      out.errors.push(`${row.instanceKey}: ${(e as Error).message}`);
    }
  }
  return out;
}
