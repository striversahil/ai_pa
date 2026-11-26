// routes/ai.ts — single AI gateway endpoint (BYOK).
//
// Every LLM call in the app funnels through here OR through getGateway()
// directly (Worker/Express import). Runners + any future caller use this HTTP
// endpoint so key material never leaves the Worker: POST /api/ai/complete.
//
// Auth: viewer session OR runner SHARED_SECRET (GH Actions). No key material
// is ever accepted in the request or echoed in the response — the pool lives
// server-side (Setting `ai:providers` JSON ONLY — env AI keys are ignored).
import type { Hono } from 'hono';
import { notifyLive, type Bindings } from '../context';
import { LiveEvent } from '../../live';
import { readBody } from '../http';
import { getAppSetting, setAppSetting, parseAiProvidersJson, validateAiProvidersJson, type AiProvidersCfg } from '../../shared/app-settings';
import { authorized, rootOnly, gatewayForRequest } from './ai-shared';
import { registerAiControlRoutes } from './ai-controls';
import { registerAiPlaygroundRoutes } from './ai-playground';
import { loadRedactedProviders } from '../ai-gateway-health';

/** Redacted config for responses: ids + key counts, never key material. */
function redacted(cfg: { providers: Array<{ id: string; baseUrl: string; model: string; keys: unknown[] }> } | null) {
  if (!cfg) return { providers: [] as Array<unknown> };
  return { providers: cfg.providers.map((p) => ({ id: p.id, baseUrl: p.baseUrl, model: p.model, keys: p.keys.length })) };
}

export function registerAiRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // Health: strategy + per-provider usable counts (fingerprints only, no keys).
  app.get('/api/ai/health', async (c) => {
    if (!(await authorized(c))) return c.json({ error: 'Authentication required' }, 401);
    const gw = await gatewayForRequest(c);
    let health: Array<{ provider: string; usable: number; total: number }> = [];
    try {
      const all = gw.health();
      const byProv = new Map<string, { usable: number; total: number }>();
      const now = Date.now();
      for (const h of all) {
        const e = byProv.get(h.provider) ?? { usable: 0, total: 0 };
        e.total++;
        if (h.enabled && h.cooldownUntil <= now) e.usable++;
        byProv.set(h.provider, e);
      }
      health = [...byProv.entries()].map(([provider, v]) => ({ provider, ...v }));
    } catch { /* ignore */ }
    // Root gets the persisted control/health state too (labels, last4, scores,
    // disabled-by) — never key material. Staff/runner responses stay as before.
    let config: Awaited<ReturnType<typeof loadRedactedProviders>> | null = null;
    if (await rootOnly(c)) {
      try { config = await loadRedactedProviders(c.env as any); } catch { config = null; }
    }
    return c.json({ ok: true, strategy: gw.strategy(), providers: health, keys: gw.keyCount, ...(config ? { config } : {}) });
  });

  // ── Provider management (root only, merge-safe) ─────────────────────────
  // The Settings GET redacts keys, so a full-replace PUT from the UI would
  // wipe keys the browser never saw. These actions mutate server-side:
  // upsert-provider (non-secret fields only, keys preserved), add-keys
  // (append, deduped), remove-key (by index into the stored array),
  // delete-provider. Responses are redacted (counts, never keys).
  app.post('/api/ai/providers', async (c) => {
    if (!(await rootOnly(c))) return c.json({ error: 'Root only' }, 403);
    const body = await readBody(c);
    const action = String((body as any)?.action ?? '');
    try {
      const raw = await getAppSetting('ai:providers');
      const cur: AiProvidersCfg = parseAiProvidersJson(raw) ?? { providers: [] };
      if (action === 'upsert-provider') {
        const id = String((body as any)?.id ?? '').trim();
        const baseUrl = String((body as any)?.baseUrl ?? '').trim().replace(/\/+$/, '');
        const model = String((body as any)?.model ?? '').trim();
        if (!id || !baseUrl || !model) return c.json({ error: 'id, baseUrl, model required' }, 400);
        const ex = cur.providers.find((p) => p.id.toLowerCase() === id.toLowerCase());
        if (ex) { ex.baseUrl = baseUrl; ex.model = model; }
        else {
          if (cur.providers.length >= 20) return c.json({ error: 'max 20 providers' }, 400);
          cur.providers.push({ id, baseUrl, model, keys: [] });
        }
        // Optional keys in the same call (atomic create + fill).
        const target = cur.providers.find((p) => p.id.toLowerCase() === id.toLowerCase())!;
        const fresh = Array.isArray((body as any)?.keys) ? (body as any).keys : [];
        if (fresh.length > 0) {
          if (target.keys.length + fresh.length > 10) return c.json({ error: 'max 10 keys per provider' }, 400);
          const seen = new Set(target.keys.map((k) => k.key));
          for (const k of fresh) {
            const kv = String((k as any)?.key ?? k ?? '').trim();
            if (!kv || seen.has(kv)) continue;
            seen.add(kv);
            target.keys.push({ key: kv, label: String((k as any)?.label ?? '').trim().slice(0, 40) || undefined });
          }
        }
      } else if (action === 'add-keys') {
        const id = String((body as any)?.id ?? '').trim();
        const keys = Array.isArray((body as any)?.keys) ? (body as any).keys : [];
        const p = cur.providers.find((x) => x.id.toLowerCase() === id.toLowerCase());
        if (!p) return c.json({ error: 'unknown provider' }, 404);
        if (keys.length === 0 || p.keys.length + keys.length > 10) {
          return c.json({ error: '1–10 keys total per provider' }, 400);
        }
        const seen = new Set(p.keys.map((k) => k.key));
        for (const k of keys) {
          const kv = String((k as any)?.key ?? k ?? '').trim();
          if (!kv || seen.has(kv)) continue;
          seen.add(kv);
          p.keys.push({ key: kv, label: String((k as any)?.label ?? '').trim().slice(0, 40) || undefined });
        }
      } else if (action === 'remove-key') {
        const id = String((body as any)?.id ?? '').trim();
        const index = Number((body as any)?.index);
        const p = cur.providers.find((x) => x.id.toLowerCase() === id.toLowerCase());
        if (!p) return c.json({ error: 'unknown provider' }, 404);
        if (!Number.isInteger(index) || index < 0 || index >= p.keys.length) {
          return c.json({ error: 'bad index' }, 400);
        }
        p.keys.splice(index, 1);
      } else if (action === 'delete-provider') {
        const id = String((body as any)?.id ?? '').trim();
        const n = cur.providers.length;
        cur.providers = cur.providers.filter((x) => x.id.toLowerCase() !== id.toLowerCase());
        if (cur.providers.length === n) return c.json({ error: 'unknown provider' }, 404);
      } else {
        return c.json({ error: 'unknown action' }, 400);
      }
      await setAppSetting('ai:providers', JSON.stringify({
        ...(cur.strategy ? { strategy: cur.strategy } : {}),
        providers: cur.providers,
      }));
      try { notifyLive(c, { type: LiveEvent.Settings }); } catch { /* non-fatal */ }
      return c.json({ ok: true, ...redacted(validateAiProvidersJson(JSON.stringify({ providers: cur.providers }))) });
    } catch (e: any) {
      return c.json({ error: String(e?.message ?? 'save failed').slice(0, 200) }, 400);
    }
  });

  // Complete: OpenAI-compatible passthrough over the server-side pool.
  app.post('/api/ai/complete', async (c) => {
    if (!(await authorized(c))) return c.json({ error: 'Authentication required' }, 401);
    const body = await readBody(c);
    const messages = (body as any)?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return c.json({ error: 'messages[] required' }, 400);
    }
    if (messages.length > 100) return c.json({ error: 'too many messages' }, 400);
    try {
      const gw = await gatewayForRequest(c);
      const req: any = {
        messages,
        temperature: typeof (body as any)?.temperature === 'number' ? (body as any).temperature : 0.2,
        ...(typeof (body as any)?.maxTokens === 'number' ? { maxTokens: (body as any).maxTokens } : {}),
        ...((body as any)?.model ? { model: String((body as any).model).slice(0, 120) } : {}),
        ...((body as any)?.provider ? { provider: String((body as any).provider).slice(0, 40) } : {}),
        ...((body as any)?.sessionKey ? { sessionKey: String((body as any).sessionKey).slice(0, 120) } : {}),
        ...(typeof (body as any)?.timeoutMs === 'number' ? { timeoutMs: Math.max(1_000, Math.min(300_000, (body as any).timeoutMs)) } : {}),
        ...((body as any)?.reasoningOff ? { reasoningOff: true } : {}),
        ...((body as any)?.reasoningEffort ? { reasoningEffort: String((body as any).reasoningEffort).slice(0, 20) } : {}),
        ...((body as any)?.json ? { json: true } : {}),
      };
      if ((body as any)?.json) {
        const out = await gw.complete({ ...req, json: true });
        return c.json({ ok: true, content: out.content, provider: out.provider, model: out.model, usage: out.usage ?? null });
      }
      const out = await gw.complete(req);
      return c.json({ ok: true, content: out.content, provider: out.provider, model: out.model, usage: out.usage ?? null });
    } catch (e: any) {
      const status = typeof (e as any)?.status === 'number' ? (e as any).status : 500;
      return c.json({ error: String((e as any)?.message ?? 'AI call failed').slice(0, 300) }, status as any);
    }
  });

  // Pool switches (provider + per-key enable) and the telemetry drill-down.
  registerAiControlRoutes(app);
  // Pinned playground probes (JSON + SSE) — root only, never changes strategy.
  registerAiPlaygroundRoutes(app);
}
