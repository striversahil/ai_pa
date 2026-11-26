// routes/ai-playground.ts — pinned key probes for Settings (root only).
//
// A probe names the exact key (fingerprint id) and provider, so it measures
// THAT key instead of letting the strategy pick one. It is the only AI entry
// that pins deliberately; production traffic still flows through
// /api/ai/complete + the pool. Rows are recorded with source='playground' and
// are excluded from health scoring (one slow test never disables a key).
//
// POST /api/ai/test         → JSON {content, metrics}
// POST /api/ai/test/stream  → SSE: meta · delta · done · error
import type { Hono } from 'hono';
import type { Bindings } from '../context';
import { readBody } from '../http';
import { rootOnly, gatewayForRequest } from './ai-shared';
import { classifyGatewayError } from '../../shared/ai-gateway-parts/metrics';

const MAX_PROMPT = 8000;
// Every gateway call (including this probe) runs to the model's own maximum
// output — no max_tokens is ever sent, so no output cap is applied here.
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;

interface ProbeSpec {
  provider: string;
  keyId: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  temperature: number;
  timeoutMs: number;
}

function parseProbe(body: any): ProbeSpec | { error: string } {
  const provider = String(body?.provider ?? '').trim();
  const keyId = String(body?.keyId ?? '').trim();
  const prompt = String(body?.prompt ?? '').trim();
  const system = String(body?.system ?? '').trim();
  if (!provider) return { error: 'provider required' };
  if (!keyId) return { error: 'keyId required' };
  if (!prompt) return { error: 'prompt required' };
  if (prompt.length > MAX_PROMPT) return { error: `prompt too long (max ${MAX_PROMPT} chars)` };
  const temperature = typeof body?.temperature === 'number' ? Math.max(0, Math.min(2, body.temperature)) : 0.2;
  // Long generations need room: a max-output answer can stream for minutes.
  const timeoutMs = Math.max(1000, Math.min(MAX_TIMEOUT_MS, Number(body?.timeoutMs) || DEFAULT_TIMEOUT_MS));
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (system) messages.push({ role: 'system', content: system.slice(0, 2000) });
  messages.push({ role: 'user', content: prompt });
  return { provider, keyId, messages, temperature, timeoutMs };
}

/** Ensure the pinned key exists AND belongs to the named provider. */
async function pinnedGateway(c: any, spec: ProbeSpec) {
  const gw = await gatewayForRequest(c);
  const key = gw.getKey(spec.keyId);
  if (!key) throw Object.assign(new Error('unknown key'), { status: 404 });
  if (key.provider !== spec.provider) throw Object.assign(new Error('key does not belong to provider'), { status: 400 });
  return { gw, key };
}

function completionMetrics(t0: number, ttftMs: number | null, usage: any) {
  const totalMs = Date.now() - t0;
  const completionTokens = Number(usage?.completion_tokens ?? 0) || 0;
  const generationMs = ttftMs == null ? totalMs : Math.max(1, totalMs - ttftMs);
  const tps = completionTokens > 0 ? Math.round((completionTokens / (generationMs / 1000)) * 10) / 10 : null;
  return { latencyMs: totalMs, ttftMs, completionTokens, totalTokens: Number(usage?.total_tokens ?? 0) || 0, tps };
}

export function registerAiPlaygroundRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.post('/api/ai/test', async (c) => {
    if (!(await rootOnly(c))) return c.json({ error: 'Root only' }, 403);
    const spec = parseProbe(await readBody(c));
    if ('error' in spec) return c.json(spec, 400);
    try {
      const { gw, key } = await pinnedGateway(c, spec);
      const t0 = Date.now();
      const out = await gw.complete({
        messages: spec.messages, provider: spec.provider, keyId: spec.keyId,
        temperature: spec.temperature,
        timeoutMs: spec.timeoutMs, source: 'playground',
      } as any);
      return c.json({
        ok: true, provider: out.provider, keyId: key.id, model: out.model,
        content: String(out.content ?? ''),
        metrics: completionMetrics(t0, null, out.usage),
      });
    } catch (e: any) {
      const status = Number(e?.status) || 502;
      return c.json({ error: String(e?.message ?? 'probe failed').slice(0, 300), kind: classifyGatewayError(status, String(e?.message ?? '')) }, status as any);
    }
  });

  app.post('/api/ai/test/stream', async (c) => {
    if (!(await rootOnly(c))) return c.json({ error: 'Root only' }, 403);
    const spec = parseProbe(await readBody(c));
    if ('error' in spec) return c.json(spec, 400);
    let gw: any;
    let key: any;
    try {
      const pinned = await pinnedGateway(c, spec);
      gw = pinned.gw; key = pinned.key;
    } catch (e: any) {
      return c.json({ error: String(e?.message ?? 'unknown key') }, (Number(e?.status) || 400) as any);
    }
    const encoder = new TextEncoder();
    const messages = spec.messages;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        const t0 = Date.now();
        let ttftMs: number | null = null;
        let text = '';
        let usage: any = null;
        send('meta', { provider: key.provider, keyId: key.id, model: key.model, label: key.label });
        try {
          for await (const chunk of gw.stream({
            messages, provider: spec.provider, keyId: spec.keyId,
            temperature: spec.temperature,
            timeoutMs: spec.timeoutMs, source: 'playground',
            signal: c.req.raw.signal,
          } as any)) {
            if (chunk.contentDelta) {
              if (ttftMs == null) ttftMs = Date.now() - t0;
              text += chunk.contentDelta;
              send('delta', { text: chunk.contentDelta });
            } else if (chunk.usage) {
              usage = chunk.usage;
            }
          }
          send('done', {
            ...completionMetrics(t0, ttftMs, usage),
            content: text,
          });
        } catch (e: any) {
          send('error', {
            message: String(e?.message ?? 'probe failed').slice(0, 300),
            kind: classifyGatewayError(Number(e?.status) || null, String(e?.message ?? '')),
          });
        } finally {
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  });
}
