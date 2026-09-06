// ─────────────────────────────────────────────────────────────────────────────
// routes/system.ts — health, waba webhook / logs / update / dashboard,
// status, brief, digests, tasks, messages, sheet data, brain, audit.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, isAuthorized, bootStatus, enrichWaEngineMedia, LiveEvent, broadcastLive, type Bindings } from '../context';

export function registerSystemRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Health ──────────────────────────────────────────────────────────────────
  app.get('/health', async (c) => c.text('ok'));
  app.get('/api/health', async (c) => {
    const { buildHealthPayload } = require('../../modules/monitoring/health');
    return c.json(await buildHealthPayload());
  });
  app.get('/api/health/whatsapp', async (c) => {
    const { buildHealthPayload } = require('../../modules/monitoring/health');
    return c.json(await buildHealthPayload());
  });

  // ── waba-worker merged endpoints (kept for local-runner + dashboard compat) ─
  app.get('/webhook', (c) => {
    const challenge = c.req.query('hub.challenge') || c.req.query('challenge');
    return c.text(challenge || 'ok', 200);
  });

  app.post('/webhook', async (c) => {
    const env = c.env;
    const raw = await c.req.text();
    try {
      const payload = JSON.parse(raw);
      const provided = c.req.header('X-Api-Key') || '';
      if (env.WA_ENGINE_API_KEY && provided && provided !== env.WA_ENGINE_API_KEY) {
        return c.text('Forbidden', 403);
      }
      const event = payload.event || '';
      if (event === 'message.received' || event === 'message.status') {
        const direction = event === 'message.received' ? 'inbound' : 'outbound';
        const d = payload.data || {};
        const message = d.message || { id: d.wa_message_id, text: { body: d.text || '' }, type: d.type || 'text' };
        const wabaId = message?.id || message?.message_id || message?.wa_id ||
          d.wa_message_id ||
          `${d.phone || d.recipient || 'unknown'}:${message?.timestamp || payload.timestamp || Date.now()}`;
        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO waba_payloads (whatsapp_id, payload, direction, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(whatsapp_id) DO UPDATE SET payload = excluded.payload, direction = excluded.direction`
        ).bind(wabaId, raw, direction, now).run();

        if (event === 'message.received') {
          const { WhatsAppController } = deps();
          let normalized = payload;
          if (!d.message) {
            const epochSec = Math.floor(new Date(payload.timestamp || Date.now()).getTime() / 1000) || Math.floor(Date.now() / 1000);
            const messageId = d.message_id || d.id || `${d.phone || 'unknown'}-${payload.timestamp || Date.now()}`;
            const message: any = { id: messageId, phone: d.phone, type: d.type || 'text', timestamp: epochSec };
            if (d.text) message.text = { body: String(d.text) };
            normalized = {
              event,
              timestamp: payload.timestamp,
              data: { ...d, message, contact: { phone_number: d.phone } },
            };
          }
          void c.executionCtx.waitUntil((async () => {
            try {
              await enrichWaEngineMedia(normalized, c.env);
            } catch (err: any) {
              console.log('waengine media enrichment failed:', err?.message);
            }
            await WhatsAppController.handleWebhook(normalized);
          })().catch((err: any) => {
            console.log('Founder-os pipeline webhook processing failed:', err?.message);
          }));
        }
      }
      return c.text('EVENT_RECEIVED', 200);
    } catch (err) {
      return c.text('Internal Processing Error', 500);
    }
  });

  app.get('/api/logs', async (c) => {
    if (!isAuthorized(c)) return c.text('Unauthorized', 401);
    const mode = c.req.query('mode');
    const chatId = c.req.query('chat');
    let query: string;
    const params: unknown[] = [];
    if (mode === 'cron') {
      query = "SELECT id, whatsapp_id, direction, payload FROM waba_payloads WHERE processed = 0 ORDER BY id ASC LIMIT 5";
    } else if (chatId) {
      query = "SELECT * FROM waba_payloads WHERE payload LIKE ? ORDER BY created_at DESC, id DESC LIMIT 100";
      params.push(`%${chatId}%`);
    } else {
      query = "SELECT * FROM waba_payloads ORDER BY created_at DESC, id DESC LIMIT 100";
    }
    const { results } = await c.env.DB.prepare(query).bind(...params).all();
    return c.json(results);
  });

  app.post('/api/update', async (c) => {
    if (!isAuthorized(c)) return c.text('Unauthorized', 401);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.id !== 'number') return c.text('Bad Request', 400);
    await c.env.DB.prepare(
      "UPDATE waba_payloads SET processed = 1, ai_result = ?, processed_at = ? WHERE id = ?"
    ).bind(body.ai_result ?? null, new Date().toISOString(), body.id).run();
    return c.text('Success', 200);
  });

  app.get('/dashboard', (c) => {
    const html = `<!DOCTYPE html><html><head><title>WhatsApp Processing Dashboard</title></head><body><h1>Merged into founder-os worker — see /api/logs</h1></body></html>`;
    return c.html(html);
  });

  // ── Status ──────────────────────────────────────────────────────────────────
  app.get('/api/status', (c) => {
    return c.json({ success: true, useInMemoryDb: false, isMockLLM: false, boot: bootStatus() });
  });

  // ── Brief ───────────────────────────────────────────────────────────────────
  app.get('/api/brief/latest', async (c) => {
    const { StorageRepository } = deps();
    const brief = await StorageRepository.fetchLatestFounderNote();
    if (!brief) return c.json({ error: 'No briefings found.' }, 404);
    return c.json(brief);
  });

  // ── Digests ─────────────────────────────────────────────────────────────────
  app.get('/api/digests', async (c) => {
    const { DigestService } = deps();
    return c.json(await DigestService.fetchAllDigests());
  });

  // ── Tasks ───────────────────────────────────────────────────────────────────
  app.get('/api/tasks', async (c) => {
    const { TasksService } = deps();
    return c.json(await TasksService.fetchTasks());
  });

  // ── Messages ────────────────────────────────────────────────────────────────
  app.get('/api/messages/:chatId', async (c) => {
    const { WhatsAppService } = deps();
    const chatId = c.req.param('chatId');
    return c.json(await WhatsAppService.fetchMessagesByChatId(chatId));
  });

  // ── Sheet data ──────────────────────────────────────────────────────────────
  app.get('/api/sheet-data', async (c) => {
    const { GoogleSheetsService } = deps();
    const spreadsheetId = c.req.query('spreadsheetId') || '1OsQevXQpPT1x2iJgcg0lgUcOInxjZh3tvfNjxAbcENs';
    const range = c.req.query('range') || 'A1:Z1000';
    return c.json(await GoogleSheetsService.getSpreadsheetData(spreadsheetId, range));
  });

  // ── Brain ───────────────────────────────────────────────────────────────────
  app.post('/api/brain/query', async (c) => {
    const { BrainService } = deps();
    const body = await c.req.json().catch(() => ({}));
    const question = body.question;
    if (!question) return c.json({ error: 'Missing question in request body' }, 400);
    const result = await BrainService.query(question, body.entityFilter);
    return c.json(result);
  });
  app.post('/api/ask-founder-ai', async (c) => {
    const { BrainService } = deps();
    const body = await c.req.json().catch(() => ({}));
    const question = body.question;
    if (!question) return c.json({ error: 'Missing question in request body' }, 400);
    const result = await BrainService.query(question, body.entityFilter);
    return c.json({ question, answer: result.answer, brainMeta: { sourcesUsed: result.sourcesUsed, contextCount: result.contextCount } });
  });
  app.get('/api/brain/stats', async (c) => {
    const { BrainService } = deps();
    return c.json(await BrainService.getStats());
  });

  // ── Audit ───────────────────────────────────────────────────────────────────
  app.get('/api/audit', async (c) => {
    const { AuditService } = deps();
    const action = c.req.query('action') || undefined;
    const entityType = c.req.query('entityType') || undefined;
    const limit = Number(c.req.query('limit') || 100);
    const since = c.req.query('since') ? new Date(c.req.query('since')!) : undefined;
    return c.json(await AuditService.query({ action, entityType, limit, since }));
  });
  app.get('/api/audit/pending', async (c) => {
    const { AuditService } = deps();
    const since = c.req.query('since') ? new Date(c.req.query('since')!) : undefined;
    return c.json(await AuditService.getPendingItems({ since }));
  });
  app.get('/api/audit/sla-breaches', async (c) => {
    const { AuditService } = deps();
    const since = c.req.query('since') ? new Date(c.req.query('since')!) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    return c.json(await AuditService.getSLABreaches(since));
  });
}

// SSE is registered here too because it is a bare /api/whatsapp/events GET.
export function registerSseRoute(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/whatsapp/events', (c) => {
    const { stream } = require('../../shared/sse-worker').handleSSEConnection();
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  });
}