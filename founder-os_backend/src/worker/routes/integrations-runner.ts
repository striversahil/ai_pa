// integrations-runner.ts — Bearer SHARED_SECRET endpoints for GitHub Actions.
//
// A runner never holds portal/AI credentials of its own: `resolve` hands it
// one instance's decrypted config (plus a fresh Zoho access token), `claim`
// leases staged rows, `ack` reports the outcome. Ingestion itself stays in the
// Worker, so there is exactly ONE mapper implementation.

import type { Hono } from 'hono';
import { requireSecret } from '../context';
import { readBody } from '../http';
import { bindGatewayContext, call, resolveInstance, IntegrationError } from '../../modules/integrations/gateway';
import { claimBatch, getRow, markFailed } from '../../modules/ingestion/store';
import { processIngestedRow } from '../../modules/ingestion/processor';
import { pollGmail } from '../../modules/ingestion/gmail-poll';

export function registerIntegrationsRunnerRoutes(app: Hono<{ Bindings: any }>): void {
  app.get('/api/runner/integrations/resolve', async (c) => {
    if (!requireSecret(c)) return c.json({ error: 'unauthorized' }, 401);
    bindGatewayContext({ db: c.env.DB, env: c.env });
    const provider = String(c.req.query('provider') ?? '').toLowerCase();
    const instanceKey = String(c.req.query('instanceKey') ?? '') || undefined;
    try {
      const instance = await resolveInstance(provider, { instanceKey });
      const out: Record<string, unknown> = {
        provider: instance.provider,
        instanceKey: instance.instanceKey,
        deliveryMode: instance.deliveryMode,
        baseUrl: instance.baseUrl,
        config: instance.config,
        secrets: instance.secrets,
      };
      if (provider === 'zoho') {
        const client: any = await call('zoho', { instanceKey: instance.instanceKey });
        out.accessToken = await client.accessToken();
        out.organizationId = instance.config.organizationId ?? '';
      }
      return c.json(out);
    } catch (error) {
      const status = error instanceof IntegrationError ? error.status : 500;
      return c.json({ error: (error as Error).message }, status as any);
    }
  });

  // The ONE inbound poller: Gmail has no push API. Every other provider is
  // webhook-only (founder decision), so this endpoint deliberately polls
  // nothing else and ignores a provider argument.
  app.post('/api/runner/integrations/poll', async (c) => {
    if (!requireSecret(c)) return c.json({ error: 'unauthorized' }, 401);
    bindGatewayContext({ db: c.env.DB, env: c.env });
    return c.json(await pollGmail(c.env.DB, c.env));
  });

  app.post('/api/runner/ingestion/claim', async (c) => {
    if (!requireSecret(c)) return c.json({ error: 'unauthorized' }, 401);
    const body = await readBody(c);
    const rows = await claimBatch(c.env.DB, {
      limit: Number(body?.limit ?? 50),
      source: body?.source ? String(body.source) : undefined,
      mode: body?.mode ? String(body.mode) : undefined,
    });
    return c.json({ rows: rows.map((row) => ({
      id: row.id, source: row.source, instanceKey: row.instanceKey,
      eventType: row.eventType, deliveryMode: row.deliveryMode,
      retryCount: row.retryCount, rawPayload: row.rawPayload,
    })) });
  });

  app.post('/api/runner/ingestion/ack', async (c) => {
    if (!requireSecret(c)) return c.json({ error: 'unauthorized' }, 401);
    bindGatewayContext({ db: c.env.DB, env: c.env });
    const body = await readBody(c);
    const results = Array.isArray(body?.results) ? body.results : [];
    let processed = 0;
    let failed = 0;
    for (const item of results) {
      const id = String(item?.id ?? '');
      if (!id || !(await getRow(c.env.DB, id))) { failed += 1; continue; }
      if (item?.error) {
        await markFailed(c.env.DB, id, String(item.error));
        failed += 1;
        continue;
      }
      const outcome = await processIngestedRow({ db: c.env.DB, env: c.env }, id);
      if (outcome.ok) processed += 1;
      else failed += 1;
    }
    return c.json({ processed, failed });
  });
}
