// routes/customer-push.ts — the Controller's "Customer push".
//
// Picks a region's customer book (state → district → client type), shows the
// exact queue, and lands it in the Founder OS auto dialer. Worker-only;
// access is sales-head / root (scope OR role, same gate as the region model).
//
// Endpoints:
//   GET  /api/customer-push/states?region=R1[&clientType=...]
//   GET  /api/customer-push/districts?region&state[&clientType]
//   GET  /api/customer-push/preview?region&state&distribution&agent[&clientType&district]
//   POST /api/customer-push/push                     land one batch
//   GET  /api/customer-push/batches?region=R1&limit=20
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { notifyLive, LiveEvent, type Bindings } from '../context';
import { requireViewer } from '../viewer';
import { readBody, writeError } from '../http';
import {
  createCustomerPush, getCustomerPushBatches, getCustomerPushDistricts,
  getCustomerPushPreview, getCustomerPushStates,
} from '../../modules/customer-push/service';
import { requireSalesManager } from './sales-access';

function fail(c: any, e: unknown) {
  const known = (e as any)?.name === 'PushError';
  if (!known) console.error('[customer-push]', (e as any)?.message);
  return writeError(c, e, 'customer push failed');
}

export function registerCustomerPushRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/customer-push/states', async (c) => {
    if (!(await requireSalesManager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    try {
      return c.json(await getCustomerPushStates(c.req.query('region'), c.req.query('clientType')));
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get('/api/customer-push/districts', async (c) => {
    if (!(await requireSalesManager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    try {
      return c.json(await getCustomerPushDistricts(c.req.query('region'), c.req.query('state'), c.req.query('clientType')));
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get('/api/customer-push/preview', async (c) => {
    if (!(await requireSalesManager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    try {
      const preview = await getCustomerPushPreview({
        region: c.req.query('region'),
        state: c.req.query('state'),
        district: c.req.query('district'),
        clientType: c.req.query('clientType'),
        distribution: c.req.query('distribution'),
        agentKey: c.req.query('agent'),
      });
      return c.json({ preview });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.post('/api/customer-push/push', async (c) => {
    if (!(await requireSalesManager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    try {
      const me: any = await requireViewer(c);
      const body = await readBody(c);
      const batch = await createCustomerPush({
        region: body?.region,
        state: body?.state,
        district: body?.district,
        clientType: body?.clientType,
        distribution: body?.distribution,
        agentKey: body?.agentKey ?? body?.agent,
      }, {
        id: String(me?.user?.id ?? ''),
        name: String(me?.user?.name ?? me?.user?.email ?? ''),
      });
      // The dialer board reads device-calls; the push writes its queue.
      notifyLive(c, { type: LiveEvent.DeviceCalls, action: 'pushed', batchId: batch.id, queued: batch.sent });
      return c.json({ batch });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get('/api/customer-push/batches', async (c) => {
    if (!(await requireSalesManager(c))) return c.json({ error: 'sales-head or root only' }, 403);
    try {
      return c.json({ batches: await getCustomerPushBatches(c.req.query('region'), c.req.query('limit')) });
    } catch (e) {
      return fail(c, e);
    }
  });
}
