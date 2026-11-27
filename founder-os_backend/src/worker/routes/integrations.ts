// routes/integrations.ts — the root-only console API for the ingestion hub.
//
// Everything here is the FOUNDER's panel: connect a service, copy its webhook
// URL, pause/rotate/remove it, browse the activity feed, inspect deliveries and
// replay one after a mapping change. Secrets (tokens, HMAC, provider keys) are
// never returned — only booleans plus the URL the founder must paste.
import type { Hono } from 'hono';
import type { Bindings } from '../context';
import { notifyLive, publicOrigin } from '../context';
import { getViewerMe } from '../viewer';
import { readBody, writeError } from '../http';
import { parsePageQuery } from '../../shared/paging';
import * as store from '../../modules/integrations/store';
import * as svc from '../../modules/integrations/service';
import { parseMapping, type MappingSpec } from '../../modules/integrations/mapping';
import type { ConnectorRow, SourceRow } from '../../modules/integrations/types';

const SECRET_FIELDS = ['apiKey', 'pageAccessToken', 'verifyToken'];
const MAPPING_LIMIT = 20000;

function kvOf(c: any) {
  return (c.env as any).CACHE_KV as any;
}

function bodyJson(raw: string): Record<string, unknown> {
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

async function rootGate(c: any): Promise<{ me: any } | { denial: Response }> {
  try {
    const me = await getViewerMe(c);
    if (!me) return { denial: c.json({ ok: false, error: 'Authentication required' }, 401) };
    if (!(me as any).isRoot) return { denial: c.json({ ok: false, error: 'Root only' }, 403) };
    return { me };
  } catch (e: any) {
    const status = typeof e?.status === 'number' ? e.status : 401;
    return { denial: c.json({ ok: false, error: e?.message ?? 'Authentication required' }, status) };
  }
}

async function viewSource(db: any, kv: any, origin: string, row: SourceRow) {
  const connector = await svc.entryForSource(db, row);
  const token = await svc.getSecret(kv, row.id, 'token');
  const view = svc.view(row, connector, token || undefined);
  return {
    ...view,
    config: bodyJson(row.config),
    mappingSpec: parseMapping(row.mapping || ''),
    secrets: await svc.secretFlags(kv, row.id, SECRET_FIELDS),
    webhookUrl: token ? origin + svc.webhookPath(row.id, token) : '',
    webhookPrefix: origin + '/api/ingest/' + row.id + '/',
  };
}

function customView(row: ConnectorRow) {
  return { ...row, mappingSpec: parseMapping(row.mapping) };
}

export function registerIntegrationRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // Everything: sources + catalog + custom connectors + live stats.
  app.get('/api/integrations', async (c) => {
    const gate = await rootGate(c); if ('denial' in gate) return gate.denial;
    const db = (c.env as any).DB; const kv = kvOf(c); const origin = publicOrigin(c);
    const rows = await store.listSources(db);
    const [sources, catalog, connectors, total, last] = await Promise.all([
      Promise.all(rows.map((r) => viewSource(db, kv, origin, r))),
      svc.buildCatalog(db),
      svc.connectorViews(db),
      db.prepare('SELECT COUNT(*) AS n FROM IntegrationEvent').first().catch(() => null),
      db.prepare('SELECT "occurredAt" AS at FROM IntegrationEvent ORDER BY "occurredAt" DESC LIMIT 1').first().catch(() => null),
    ]);
    return c.json({
      ok: true, sources, catalog, connectors: connectors.map(customView),
      stats: { sources: rows.length, events: Number((total as any)?.n ?? 0), lastEventAt: (last as any)?.at ?? '' },
    });
  });

  app.get('/api/integrations/catalog', async (c) => {
    const gate = await rootGate(c); if ('denial' in gate) return gate.denial;
    const db = (c.env as any).DB;
    return c.json({ ok: true, catalog: await svc.buildCatalog(db), connectors: (await svc.connectorViews(db)).map(customView) });
  });

  // Activity feed: paged, whole-table search, no raw payload in the list.
  app.get('/api/integrations/events', async (c) => {
    const gate = await rootGate(c); if ('denial' in gate) return gate.denial;
    const db = (c.env as any).DB;
    const req = parsePageQuery((k) => c.req.query(k));
    const page = await store.listEvents(db, req, {
      q: c.req.query('q'), sourceId: c.req.query('sourceId'), kind: c.req.query('kind'),
      from: c.req.query('from'), to: c.req.query('to'),
    });
    const rows = page.rows.map((r) => ({ ...r, payload: '', raw: '', hasPayload: !!r.raw }));
    return c.json({ ok: true, ...page, rows });
  });

  app.get('/api/integrations/events/:id', async (c) => {
    const gate = await rootGate(c); if ('denial' in gate) return gate.denial;
    const db = (c.env as any).DB;
    const row = await store.getEvent(db, c.req.param('id'));
    if (!row) return c.json({ ok: false, error: 'Not found' }, 404);
    const source = await store.getSource(db, row.sourceId);
    return c.json({ ok: true, event: { ...row, payloadObject: bodyJson(row.payload), rawObject: bodyJson(row.raw) }, source });
  });

  // Dry run: paste a payload + a mapping, get the events and warnings. Writes nothing.
  app.post('/api/integrations/preview', async (c) => {
    const gate = await rootGate(c); if ('denial' in gate) return gate.denial;
    const body = await readBody<any>(c);
    const raw = typeof body.payload === 'string' ? body.payload : JSON.stringify(body.payload ?? {});
    if (raw.length > 256 * 1024) return c.json({ ok: false, error: 'Payload too large' }, 413);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return c.json({ ok: false, error: 'Sample is not valid JSON' }, 400); }
    const spec: MappingSpec = body.mapping && typeof body.mapping === 'object' ? body.mapping : { fields: {} };
    const connectorKey = String(body.connectorKey ?? 'generic');
    const result = svc.previewEvents(payload, connectorKey, spec);
    return c.json({ ok: true, events: result.events, warnings: result.warnings });
  });

  // ── Custom services (the "add any service later" path) ──────────────────
  app.post('/api/integrations/connectors', async (c) => {
    const gate = await rootGate(c); if ('denial' in gate) return gate.denial;
    const db = (c.env as any).DB;
    const body = await readBody<any>(c);
    try {
      const row = await svc.createConnector(db, {
        name: body.name, icon: body.icon, color: body.color,
        mapping: body.mapping, sample: typeof body.sample === 'string' ? body.sample : '',
      }, { id: String(gate.me.user.id), name: String(gate.me.user.name ?? '') });
      return c.json({ ok: true, connector: customView(row) }, 201);
    } catch (e) { return writeError(c, e, 'Could not create the service'); }
  });

  app.patch('/api/integrations/connectors/:id', async (c) => {
    const gate = await rootGate(c); if ('denial' in gate) return gate.denial;
    const db = (c.env as any).DB;
    const id = c.req.param('id');
    const body = await readBody<any>(c);
    const patch: Record<string, unknown> = {};
    for (const k of ['name', 'icon', 'color', 'sample', 'status']) if (k in body) patch[k] = String(body[k] ?? '').slice(0, 20000);
    if ('mapping' in body) patch.mapping = JSON.stringify(body.mapping ?? { fields: {} }).slice(0, MAPPING_LIMIT);
    await store.patchConnector(db, id, patch);
    const row = await store.getConnector(db, id);
    return row ? c.json({ ok: true, connector: customView(row) }) : c.json({ ok: false, error: 'Not found' }, 404);
  });

  app.delete('/api/integrations/connectors/:id', async (c) => {
    const gate = await rootGate(c); if ('denial' in gate) return gate.denial;
    const db = (c.env as any).DB;
    const row = await store.getConnector(db, c.req.param('id'));
    if (!row) return c.json({ ok: false, error: 'Not found' }, 404);
    const used = await store.connectorUsage(db, row.key);
    if (used > 0) return c.json({ ok: false, error: `Still used by ${used} connection(s) — remove those first` }, 409);
    await store.deleteConnector(db, row.id);
    return c.json({ ok: true });
  });

  // ── Connections ─────────────────────────────────────────────────────────
  app.post('/api/integrations', async (c) => {
    const gate = await rootGate(c); if ('denial' in gate) return gate.denial;
    const db = (c.env as any).DB; const kv = kvOf(c);
    const body = await readBody<any>(c);
    try {
      const created = await svc.createSource(db, kv, {
        connectorKey: body.connectorKey, connectorId: body.connectorId, newConnector: body.newConnector,
        name: body.name, config: body.config, mapping: body.mapping,
      }, { id: String(gate.me.user.id), name: String(gate.me.user.name ?? '') });
      const origin = publicOrigin(c);
      notifyLive(c, { type: 'integrations' });
      return c.json({
        ok: true,
        source: { ...created.source, webhookUrl: origin + svc.webhookPath(created.source.id, created.token) },
        token: created.token,
        signingSecret: created.signingSecret,
      }, 201);
    } catch (e) { return writeError(c, e, 'Could not create the connection'); }
  });

  app.patch('/api/integrations/:id', async (c) => {
    const gate = await rootGate(c); if ('denial' in gate) return gate.denial;
    const db = (c.env as any).DB; const kv = kvOf(c);
    const id = c.req.param('id');
    const source = await store.getSource(db, id);
    if (!source) return c.json({ ok: false, error: 'Not found' }, 404);
    const body = await readBody<any>(c);
    const patch: Record<string, unknown> = {};
    if ('name' in body) patch.name = String(body.name ?? '').trim().slice(0, 120);
    if ('status' in body) patch.status = body.status === 'paused' ? 'paused' : 'active';
    if ('mapping' in body) patch.mapping = body.mapping ? JSON.stringify(body.mapping).slice(0, MAPPING_LIMIT) : '';
    if ('config' in body && body.config && typeof body.config === 'object') {
      const config: Record<string, unknown> = { ...body.config };
      for (const key of SECRET_FIELDS) {
        if (!(key in config)) continue;
        const value = String(config[key] ?? '').trim();
        delete config[key];
        if (value) await svc.putSecret(kv, id, key, value);
      }
      patch.config = JSON.stringify(config);
    }
    await store.patchSource(db, id, patch);
    const fresh = await store.getSource(db, id);
    notifyLive(c, { type: 'integrations' });
    return c.json({ ok: true, source: await viewSource(db, kv, publicOrigin(c), fresh as SourceRow) });
  });

  app.delete('/api/integrations/:id', async (c) => {
    const gate = await rootGate(c); if ('denial' in gate) return gate.denial;
    const db = (c.env as any).DB; const kv = kvOf(c);
    const id = c.req.param('id');
    const source = await store.getSource(db, id);
    if (!source) return c.json({ ok: false, error: 'Not found' }, 404);
    const purge = c.req.query('purge') === '1';
    await store.deleteSource(db, id, purge);
    await svc.deleteSecrets(kv, id, ['token', 'hmac', ...SECRET_FIELDS]);
    notifyLive(c, { type: 'integrations' });
    return c.json({ ok: true, purged: purge });
  });

  app.post('/api/integrations/:id/rotate', async (c) => {
    const gate = await rootGate(c); if ('denial' in gate) return gate.denial;
    const db = (c.env as any).DB; const kv = kvOf(c);
    const source = await store.getSource(db, c.req.param('id'));
    if (!source) return c.json({ ok: false, error: 'Not found' }, 404);
    const token = await svc.rotateSource(db, kv, source);
    notifyLive(c, { type: 'integrations' });
    return c.json({ ok: true, token, webhookUrl: publicOrigin(c) + svc.webhookPath(source.id, token) });
  });

  app.get('/api/integrations/:id/deliveries', async (c) => {
    const gate = await rootGate(c); if ('denial' in gate) return gate.denial;
    const db = (c.env as any).DB;
    const req = parsePageQuery((k) => c.req.query(k));
    const page = await store.listDeliveries(db, req, c.req.param('id'));
    return c.json({ ok: true, ...page });
  });

  app.post('/api/integrations/:id/events/:eventId/replay', async (c) => {
    const gate = await rootGate(c); if ('denial' in gate) return gate.denial;
    const db = (c.env as any).DB;
    const source = await store.getSource(db, c.req.param('id'));
    if (!source) return c.json({ ok: false, error: 'Not found' }, 404);
    const event = await store.getEvent(db, c.req.param('eventId'));
    if (!event || event.sourceId !== source.id) return c.json({ ok: false, error: 'Not found' }, 404);
    const connector = await svc.entryForSource(db, source);
    const result = await svc.replayEvent(db, source, connector, event);
    if (!result.ok) return c.json({ ok: false, error: result.error }, 422);
    notifyLive(c, { type: 'ingest' });
    return c.json({ ok: true, event: result.event });
  });
}