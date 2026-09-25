// ─────────────────────────────────────────────────────────────────────────────
// routes/copilot.ts — generic department-copilot endpoints (thin orchestrator).
// Dispatches through the copilot registry (src/copilot): each department owns
// its def (tools, prompt, access). Sales keeps its own store-bound endpoints
// in routes/enquiries.ts; all registry copilots share these three routes.
// Mirror: founder-os_backend/src/server.ts (Express alt runtime, non-stream).
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { authStore, getMe, notifyLive, readSessionCookie, LiveEvent, type Bindings } from '../context';
import { getCopilot } from '../../copilot/registry';
import { clearState, runTurn, streamTurn } from '../../copilot/engine';
import type { CopilotReply } from '../../copilot/types';

function sseResponse(gen: AsyncGenerator<{ type: string; data: any }, CopilotReply, unknown>): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (type: string, data: any) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
      };
      try {
        for await (const evt of gen) send(evt.type, evt.data);
        controller.enqueue(enc.encode('data: [DONE]\n\n'));
      } catch (e: any) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'error', data: { error: String(e?.message ?? e).slice(0, 500) } })}\n\n`));
        controller.enqueue(enc.encode('data: [DONE]\n\n'));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}

function chatError(c: any, e: any) {
  const msg = String(e?.message ?? 'chat failed');
  const is429 = /429|rate-limit/i.test(msg) || (e as any)?.status === 429;
  console.error('copilot chat failed', (e as any)?.stack ?? msg);
  if (is429) return c.json({ error: 'Rate-limited — please wait a minute and retry.', reply: 'The AI is busy (rate-limited). Please retry in 60 seconds.' }, 429);
  return c.json({ error: msg.slice(0, 500), reply: 'Chat failed — please retry.' }, 500);
}

export function registerCopilotRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.post('/api/copilot/:id/chat', async (c) => {
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    const def = getCopilot(c.req.param('id') ?? '');
    if (!def) return c.json({ error: 'unknown copilot' }, 404);
    const denied = def.checkAccess(me);
    if (denied) return c.json({ error: denied.error }, denied.status as any);
    const body = await c.req.json().catch(() => ({}));
    const message = String(body?.message ?? '').trim().slice(0, 2000);
    if (!message) return c.json({ error: 'message required' }, 400);
    try {
      const ctx = await def.buildCtx(c.env as any, me, {});
      return c.json(await runTurn(c.env as any, def, ctx, message));
    } catch (e: any) {
      return chatError(c, e);
    }
  });
  app.post('/api/copilot/:id/chat/stream', async (c) => {
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    const def = getCopilot(c.req.param('id') ?? '');
    if (!def) return c.json({ error: 'unknown copilot' }, 404);
    const denied = def.checkAccess(me);
    if (denied) return c.json({ error: denied.error }, denied.status as any);
    const body = await c.req.json().catch(() => ({}));
    const message = String(body?.message ?? '').trim().slice(0, 2000);
    if (!message) return c.json({ error: 'message required' }, 400);
    try {
      const ctx = await def.buildCtx(c.env as any, me, {});
      return sseResponse(streamTurn(c.env as any, def, ctx, message));
    } catch (e: any) {
      return chatError(c, e);
    }
  });
  // New chat — wipes rolling history + draft state. The 50-request window
  // is only for back-to-back chat; a fresh chat starts with zero memory.
  app.post('/api/copilot/:id/chat/clear', async (c) => {
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    const def = getCopilot(c.req.param('id') ?? '');
    if (!def) return c.json({ error: 'unknown copilot' }, 404);
    const denied = def.checkAccess(me);
    if (denied) return c.json({ error: denied.error }, denied.status as any);
    try {
      const ctx = await def.buildCtx(c.env as any, me, {});
      await clearState(def, ctx);
      return c.json({ ok: true });
    } catch (e: any) {
      return c.json({ error: String((e as any)?.message ?? 'clear failed').slice(0, 300) }, 500);
    }
  });
  // Confirm path — only for copilots that return proposals (read-only ones 404).
  app.post('/api/copilot/:id/chat/execute', async (c) => {
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    const def = getCopilot(c.req.param('id') ?? '');
    if (!def) return c.json({ error: 'unknown copilot' }, 404);
    const denied = def.checkAccess(me);
    if (denied) return c.json({ error: denied.error }, denied.status as any);
    if (!def.executeProposal) return c.json({ error: 'this copilot is read-only', applied: 'none' }, 400);
    const body = await c.req.json().catch(() => ({}));
    try {
      const ctx = await def.buildCtx(c.env as any, me, {});
      const { result, applied } = await def.executeProposal(
        ctx, (body?.action && typeof body.action === 'object' ? body.action : {}) as Record<string, any>,
      );
      // Intake-style defs flag catalogue writes so dashboards refresh live.
      if (applied !== 'none' && (result.body as any)?.live === 'product-line') {
        notifyLive(c, { type: LiveEvent.ProductLine });
      }
      return c.json({ ...(result.body as any), applied }, (result as any).status as any);
    } catch (e: any) {
      console.error('copilot/execute failed', (e as any)?.stack ?? String((e as any)?.message ?? e));
      return c.json({ error: String((e as any)?.message ?? 'apply failed').slice(0, 300), applied: 'none' }, 500);
    }
  });
}
