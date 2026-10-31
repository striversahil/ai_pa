// ─────────────────────────────────────────────────────────────────────────────
// routes/neodove-campaign.ts — push Customer Master leads into a NeoDove
// agent campaign (one lead per POST to the agent's custom-integration URL).
//
// Worker-only (Express is frozen). Access is sales-head / MIS / root, checked
// by scope OR role so a sales-head role holder is never locked out by a missing
// scope grant (same rule as the telecalling roster).
//
// Endpoints:
//   GET  /api/neodove/campaign/states?region=R1      agents + state dropdown
//   GET  /api/neodove/campaign/preview?region&state&distribution&agent
//   POST /api/neodove/campaign/push                  create batch
//   POST /api/neodove/campaign/push/:id/run          send next chunk
//   GET  /api/neodove/campaign/batches?region=R1     push history
//   PUT  /api/neodove/campaign/agents/:key/url      map an agent's campaign URL
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import {
  authStore, getMe, isApproved, readSessionCookie, notifyLive, LiveEvent, type Bindings,
} from '../context';
import { AuthError } from '../../modules/auth/types';
import {
  CampaignError, createPush, getCampaignBatches, getCampaignPreview, getCampaignStates,
  runBatchChunk, setAgentCampaignUrl,
} from '../../modules/neodove-campaign/service';

async function meFor(c: any) {
  return getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
}

/** Root / MIS / sales-head — scope OR role, mirroring the roster gate. */
async function requireCampaignManager(c: any) {
  const me: any = await meFor(c);
  if (!me) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
  if (!isApproved(me)) throw new AuthError('FORBIDDEN', 'Account not approved', 403);
  const scopes: string[] = me.scopes ?? [];
  const roles: string[] = me.roles ?? [];
  const allowed = !!me.isAdmin
    || scopes.includes('mis') || roles.includes('mis')
    || scopes.includes('sales-head') || roles.includes('sales-head');
  if (!allowed) throw new AuthError('FORBIDDEN', 'sales-head, MIS or root only', 403);
  return me;
}

function fail(c: any, e: unknown) {
  if (e instanceof CampaignError) return c.json({ error: e.message }, e.status as any);
  if (e instanceof AuthError) return c.json({ error: e.message }, ((e as any).status ?? 403) as any);
  console.error('[neodove-campaign]', (e as any)?.message);
  return c.json({ error: 'campaign push failed' }, 500);
}

export function registerNeodoveCampaignRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/neodove/campaign/states', async (c) => {
    try {
      await requireCampaignManager(c);
      const payload = await getCampaignStates(c.env, c.req.query('region'));
      return c.json(payload);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get('/api/neodove/campaign/preview', async (c) => {
    try {
      await requireCampaignManager(c);
      const preview = await getCampaignPreview(
        c.env,
        c.req.query('region'),
        c.req.query('state'),
        c.req.query('distribution'),
        c.req.query('agent'),
      );
      return c.json({ preview });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.post('/api/neodove/campaign/push', async (c) => {
    try {
      const me: any = await requireCampaignManager(c);
      const body = await c.req.json().catch(() => ({}));
      const batch = await createPush(c.env, {
        region: body?.region,
        state: body?.state,
        distribution: body?.distribution,
        agentKey: body?.agentKey ?? body?.agent,
        actor: { id: String(me?.user?.id ?? ''), name: String(me?.user?.name ?? me?.user?.email ?? '') },
      });
      notifyLive(c, { type: LiveEvent.NeodoveCampaign, batchId: batch.id, status: batch.status });
      return c.json({ batch });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.post('/api/neodove/campaign/push/:id/run', async (c) => {
    try {
      await requireCampaignManager(c);
      const body = await c.req.json().catch(() => ({}));
      const progress = await runBatchChunk(c.env, c.req.param('id'), Number(body?.chunk ?? 20));
      if (progress.complete) {
        notifyLive(c, { type: LiveEvent.NeodoveCampaign, batchId: progress.id, status: progress.status, done: true });
      }
      return c.json({ progress });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get('/api/neodove/campaign/batches', async (c) => {
    try {
      await requireCampaignManager(c);
      const batches = await getCampaignBatches(c.req.query('region'), Number(c.req.query('limit') ?? 20));
      return c.json({ batches });
    } catch (e) {
      return fail(c, e);
    }
  });

  // Map an agent's campaign URL from the Controller. Accepts a bare URL or a
  // full curl command (the server extracts the URL); empty clears the DB
  // override so the Worker secret becomes effective again. The URL itself is
  // never returned — only the host + source, so the secret-equivalent value
  // stays out of every payload and log.
  app.put('/api/neodove/campaign/agents/:key/url', async (c) => {
    try {
      await requireCampaignManager(c);
      const body = await c.req.json().catch(() => ({}));
      const result = await setAgentCampaignUrl(
        c.env,
        c.req.param('key'),
        body?.url ?? body?.curl ?? body?.value ?? '',
      );
      notifyLive(c, { type: LiveEvent.NeodoveCampaign, agentKey: result.key, source: result.source });
      return c.json({ agent: result });
    } catch (e) {
      return fail(c, e);
    }
  });
}
