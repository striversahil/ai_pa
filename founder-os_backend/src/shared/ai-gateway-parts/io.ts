// Extracted verbatim from ai-gateway.ts by scripts/refactor/split-module.mjs.
// ai-gateway.ts re-exports everything public here, so existing imports keep working.
import { cacheGet, cacheSet, cacheKeys } from "../cache";
import { logger } from "../logger";
import { gatewayUsageKey, GATEWAY_USAGE_TTL_MS, GATEWAY_USAGE_PREFIX, MODEL_DOWN_TTL_MS, KeyPool, OPENROUTER_TEXT_MODEL, PROVIDERS, hashAI, FALLBACK_MODEL, sleep, AiGatewayError, extractJson } from "./pure";
import { emitGatewayMetric, classifyGatewayError, metricSource } from "./metrics";
import type { KeyHealth, ProviderConfig, CompletionRequest, CompletionResult, AiKey, ToolCall } from "./types";

export async function logGatewayUsage(usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }): Promise<void> {
  try {
    const key = gatewayUsageKey();
    const rec = await cacheGet<{ prompt: number; completion: number; total: number; calls: number }>(key, GATEWAY_USAGE_TTL_MS).catch(() => null);
    const u = usage ?? {};
    await cacheSet(key, {
      prompt: (rec?.prompt ?? 0) + (u.prompt_tokens ?? 0),
      completion: (rec?.completion ?? 0) + (u.completion_tokens ?? 0),
      total: (rec?.total ?? 0) + (u.total_tokens ?? 0),
      calls: (rec?.calls ?? 0) + 1,
    }, GATEWAY_USAGE_TTL_MS);
  } catch { /* best-effort */ }
}

export async function readGatewayUsage(days: number): Promise<{ total: number; calls: number; byDay: Array<{ day: string; total: number; calls: number }> }> {
  const out = { total: 0, calls: 0, byDay: [] as Array<{ day: string; total: number; calls: number }> };
  const n = Math.min(30, Math.max(1, Math.floor(days) || 7));
  const cutoff = new Date(Date.now() - n * 24 * 60 * 60_000).toISOString().slice(0, 10);
  let names: string[] = [];
  try { names = await cacheKeys(GATEWAY_USAGE_PREFIX, 1000); } catch { names = []; }
  const perDay = new Map<string, { total: number; calls: number }>();
  for (const name of names) {
    const m = /^ai:usage:(\d{4}-\d{2}-\d{2})$/.exec(name);
    if (!m) continue;
    const [, day] = m;
    if (day < cutoff) continue;
    let rec: { total?: number; calls?: number } | null = null;
    try { rec = await cacheGet<any>(name, GATEWAY_USAGE_TTL_MS).catch(() => null); } catch { rec = null; }
    const total = Number(rec?.total ?? 0);
    const calls = Number(rec?.calls ?? 0);
    if (!(total > 0)) continue;
    out.total += total;
    out.calls += calls;
    perDay.set(day, { total, calls });
  }
  out.byDay = [...perDay.entries()]
    .map(([day, v]) => ({ day, total: v.total, calls: v.calls }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
  return out;
}

export async function modelFlagged(model: string): Promise<boolean> {
  try {
    return !!(await cacheGet(`ai:modeldown:${model}`, MODEL_DOWN_TTL_MS));
  } catch {
    return false;
  }
}

export async function flagModelDown(model: string): Promise<void> {
  try {
    await cacheSet(`ai:modeldown:${model}`, { at: Date.now() }, MODEL_DOWN_TTL_MS);
  } catch { /* best-effort */ }
}

export class AiGateway {
  private pool = new KeyPool();
  private visionModelOverride = '';
  /** Rotating OpenRouter free-model list (OPENROUTER_FREE_MODELS). Text
   *  requests cycle through these as 429s persist; vision stays pinned. */
  private openrouterModels: string[] = [OPENROUTER_TEXT_MODEL];
  private modelIdx = 0;
  // Cloudflare AI Gateway (standardized): when CLOUDFLARE_ACCOUNT_ID + CF_AIG_GATEWAY_ID are set,
  // all providers route via https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/...
  // as reverse proxy with caching/rate-limiting/logging. Custom providers use `custom-{slug}`.
  private aigAccount = '';
  private aigGateway = '';

  constructor(env?: Record<string, unknown>) {
    if (env) this.configure(env);
  }

  configure(env: Record<string, unknown>): void {
    this.pool.loadFromEnv(env);
    const v = String((env as any)?.VISION_MODEL ?? '').trim();
    if (v) this.visionModelOverride = v;
    const aigAcc = String((env as any)?.CLOUDFLARE_ACCOUNT_ID ?? (env as any)?.CF_AIG_ACCOUNT_ID ?? '').trim();
    const aigId = String((env as any)?.CF_AIG_GATEWAY_ID ?? (env as any)?.AI_GATEWAY_ID ?? 'founder-os').trim();
    if (aigAcc) { this.aigAccount = aigAcc; this.aigGateway = aigId; }
    const models = String((env as any)?.OPENROUTER_FREE_MODELS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (models.length > 0) this.openrouterModels = [...new Set(models)];
  }

  get keyCount(): number {
    return this.pool.size;
  }

  /** Apply runtime Setting config (ai:strategy + ai:providers JSON). Env keys
   *  stay loaded; Setting providers merge in (same key deduped). */
  configureFromSettings(settings: Record<string, string>): void {
    try {
      const s = String(settings?.['ai:strategy'] ?? '').trim();
      if (s === 'round-robin' || s === 'least-used-first') this.pool.setStrategy(s);
    } catch { /* ignore */ }
    try {
      const raw = String(settings?.['ai:providers'] ?? '').trim();
      if (!raw) return;
      const parsed: any = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed?.providers;
      if (!Array.isArray(list)) return;
      if (typeof parsed?.strategy === 'string') {
        const ps = String(parsed.strategy).trim();
        if (ps === 'round-robin' || ps === 'least-used-first') this.pool.setStrategy(ps);
      }
      for (const p of list.slice(0, 20)) {
        const id = String(p?.id ?? '').trim();
        const baseUrl = String(p?.baseUrl ?? p?.baseURL ?? '').trim();
        const model = String(p?.model ?? '').trim();
        const keys = Array.isArray(p?.keys) ? p.keys : [];
        if (!id || !baseUrl || !model || keys.length === 0) continue;
        this.pool.registerProvider(id, baseUrl, model, keys.slice(0, 10), p?.enabled !== false);
      }
    } catch { /* fail-open: bad JSON never breaks chat */ }
  }

  strategy(): string {
    try { return this.pool.getStrategy(); } catch { return 'least-used-first'; }
  }

  health(): KeyHealth[] {
    return this.pool.health();
  }

  /** Direct key lookup for the Settings playground (pinned probe, no strategy).
   *  Disabled keys are still returned on purpose: a root user testing a key
   *  that is currently off must see WHY it is off. */
  getKey(id: string): AiKey | null {
    return this.findKey(String(id ?? ""));
  }

  private gatewayBaseURL(provider: ProviderConfig): string {
    if (this.aigAccount && this.aigGateway) {
      // Standardized Cloudflare AI Gateway reverse proxy (custom providers use custom-{slug})
      if (provider.id === 'openrouter' || provider.id === 'openrouter-paid') return `https://gateway.ai.cloudflare.com/v1/${this.aigAccount}/${this.aigGateway}/custom-openrouter/api/v1/chat/completions`;
      if (provider.id === 'groq') return `https://gateway.ai.cloudflare.com/v1/${this.aigAccount}/${this.aigGateway}/groq/chat/completions`;
      if (provider.id === 'requestly') return provider.baseURL; // not via gateway
    }
    return provider.baseURL;
  }

  /**
   * Core completion call. Picks a key, calls the provider, rotates + retries on
   * transient/provider errors (bounded by maxAttempts — one fresh key per
   * attempt, so N keys ≈ N chances). Per-key 429s cool that key (escalating)
   * and rotate to the next; Cloudflare 1015 cools briefly and also rotates.
   * Sticky `sessionKey` requests stay pinned while healthy.
   * Throws AiGatewayError only when every attempt is exhausted.
   *
   * Cloudflare AI Gateway note: rotation only swaps the `Authorization: Bearer`
   * header value. URLs (incl. `custom-*` gateway paths), bodies, and models are
   * untouched, so CF-side caching / logging / rate-limiting see zero change —
   * and CF cache keys (method+URL+body) are unaffected by Bearer rotation.
   */
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const startedAt = Date.now();
    // Standardized app-wide: KV response cache (5m) + single-flight + fail-fast 429.
    // Caches identical prompts (enquiry extraction re-tries, duplicate saves) to cut RPM without extra keys.
    const cacheable = !req.signal?.aborted && (req.json || false) && !req.tools?.length;
    // Only cache deterministic JSON extractions (enrichment/vision) — chat (tools/stream) bypasses.
    let aiCacheKey: string | null = null;
    if (cacheable) {
      try {
        const prov = req.provider || 'openrouter';
        const model = req.model || PROVIDERS[prov]?.defaultModel || OPENROUTER_TEXT_MODEL;
        const keyRaw = JSON.stringify({ prov, model, messages: req.messages, temperature: req.temperature ?? 0.2, json: !!req.json });
        aiCacheKey = `ai:resp:${hashAI(keyRaw)}`;
        const hit = await cacheGet<CompletionResult>(aiCacheKey, 5 * 60 * 1000);
        if (hit) { logger.info?.(`[AiGateway] cache hit ${aiCacheKey.slice(0, 24)}`); return hit; }
      } catch {}
    }
    // Standardized: fail fast, respect retry-after, no 50× hammer.
    // Heavy app will queue at caller, not in gateway. 3 attempts max.
    const MIN_ATTEMPTS = 3;
    const maxAttempts = Math.max(MIN_ATTEMPTS, Math.min(this.pool.size || MIN_ATTEMPTS, 5));
    const wantsVision = req.messages.some((m) => Array.isArray(m.content));
    // Model rotation (OpenRouter text requests only): every ROTATE_EVERY
    // consecutive 429s moves to the next OPENROUTER_FREE_MODELS entry,
    // spreading quota. Explicit req.model, vision requests, and non-OpenRouter
    // providers never rotate.
    const ROTATE_EVERY = 5;
    let streak429 = 0;
    let rotatedModel: string | undefined;
    let lastErr: unknown;
    // Model fallback state: an explicitly requested model with a recorded
    // outage starts on its fallback immediately; a mid-call hang switches
    // over once (flagged for 10 min so later calls skip the probe).
    let activeModel: string | undefined = req.model;
    let fellBack = false;
    // One ledger row per failed attempt (not just the final throw), so a key's
    // 429/5xx streak is attributable in health instead of landing on the pool.
    const emitFailure = (key: any, err: unknown) => {
      const status = this.pool.extractStatus(err);
      emitGatewayMetric({
        provider: key.provider, keyId: key.id, ok: false, status,
        errorKind: classifyGatewayError(status, String((err as any)?.message ?? err)),
        latencyMs: Date.now() - startedAt, streamed: false, source: metricSource(req),
      });
    };
    if (activeModel && FALLBACK_MODEL[activeModel] && (await modelFlagged(activeModel))) {
      logger.warn?.(`[AiGateway] ${activeModel} flagged down — starting on ${FALLBACK_MODEL[activeModel]}`);
      activeModel = FALLBACK_MODEL[activeModel];
      fellBack = true;
    }
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const key = req.keyId
        ? this.findKey(req.keyId) ?? this.pool.select(req.provider, req.sessionKey)
        : this.pool.select(req.provider, req.sessionKey);
      if (!key) {
        const waitMs = this.pool.earliestCooldownMs();
        const retryAfter = waitMs > 0 ? Math.min(waitMs, 60_000) : 60_000;
        const e: any = new Error(`HTTP 429: Rate-limited (retry after ${Math.round(retryAfter/1000)}s)`);
        e.status = 429; e.retryAfter = retryAfter;
        emitGatewayMetric({
          provider: req.provider ?? "pool", keyId: "pool:none", ok: false, status: 429,
          errorKind: "rate_limit", latencyMs: Date.now() - startedAt, streamed: false,
          source: metricSource(req),
        });
        throw e;
      }
      const provider = PROVIDERS[key.provider] ?? PROVIDERS.groq;
      try {
        const modelOverride = activeModel && activeModel !== req.model ? activeModel : rotatedModel;
        const callReq = { ...req };
        if (modelOverride) callReq.model = modelOverride;
        // Cheap probe: pre-fallback attempts on a flaky primary model get
        // probeTimeoutMs; everything after fallback uses timeoutMs.
        const probing = !fellBack && req.model && FALLBACK_MODEL[req.model] && req.probeTimeoutMs;
        if (probing) callReq.timeoutMs = req.probeTimeoutMs;
        const result = await this.callProvider(provider, key, callReq);
        this.pool.reportSuccess(key);
        // Proof-of-use audit: which key fingerprint + model served the call
        // (no secret material — id is provider + first6/last4 only). The
        // model half proves runtime Settings (chat/intake model selectors).
        logger.info?.(`[AiGateway] served by ${key.id} (${provider.id}/${callReq.model ?? provider.defaultModel})`);
        if (aiCacheKey) {
          try { await cacheSet(aiCacheKey, result, 5 * 60 * 1000); } catch {}
        }
        if (result.usage) await logGatewayUsage(result.usage);
        emitGatewayMetric({
          provider: key.provider, keyId: key.id, ok: true, status: 200,
          latencyMs: Date.now() - startedAt, streamed: false,
          promptTokens: result.usage?.prompt_tokens ?? null,
          completionTokens: result.usage?.completion_tokens ?? null,
          totalTokens: result.usage?.total_tokens ?? null,
          source: metricSource(req),
        });
        return result;
      } catch (err) {
        lastErr = err;
        // Hung model channel (timeout, no HTTP status — caller cancels
        // excluded): record the outage, switch to the fallback model, retry
        // immediately. Keys are never rotated for a hang — every key would
        // hang identically on a dead channel.
        const timedOut = (err as any)?.name === 'TimeoutError' || /timeout/i.test(String((err as any)?.message ?? ''));
        if (timedOut && req.model && FALLBACK_MODEL[req.model] && !fellBack) {
          fellBack = true;
          await flagModelDown(req.model);
          logger.warn?.(`[AiGateway] ${req.model} hung — failing over to ${FALLBACK_MODEL[req.model]}`);
          activeModel = FALLBACK_MODEL[req.model];
          continue;
        }
        const status = this.pool.extractStatus(err);
        if (status === 429) {
          const msg = String((err as any)?.message ?? '');
          const isCf1015 = /1015|error code: 1015/i.test(msg);
          const retryAfter = this.extractRetryAfter(err);
          if (isCf1015) {
            // IP-level throttle, NOT key quota: cool briefly and ROTATE.
            // Only the final attempt throws, preserving chat's busy-signal
            // when truly everything is throttled.
            const rawCd = retryAfter ?? 72_000;
            const cd = Math.min(rawCd, 60_000);
            key.cooldownUntil = Date.now() + cd;
            key.failures++;
            key.lastFailureAt = Date.now();
            key.lastError = `429 Cloudflare 1015`;
            logger.warn?.(`[AiGateway] 429 Cloudflare 1015 on ${key.id} — cooling ${Math.round(cd/1000)}s (raw ${Math.round(rawCd/1000)}s), rotating to next key (attempt ${attempt + 1}/${maxAttempts})`);
            emitFailure(key, err);
            if (attempt >= maxAttempts - 1) {
              const e: any = new Error(`HTTP 429: Rate-limited (Cloudflare 1015, retry after ${Math.round(cd/1000)}s)`);
              e.status = 429; e.retryAfter = cd; throw e;
            }
            continue;
          }
          // Per-key quota: cool THIS key and rotate to the next one in the
          // pool (bounded by maxAttempts). The next select() skips the
          // cooling key, so a sticky sessionKey transparently fails over
          // mid-conversation only when it must. Cooldown escalates while the
          // key keeps failing (60s → 120s → 240s → 480s, capped 10 min) so
          // chronic-429 keys stop burning seconds on every rejoin; one
          // success resets the ladder.
          streak429++;
          if (
            !req.model && !wantsVision && provider.id === 'openrouter' &&
            this.openrouterModels.length > 1 && streak429 % ROTATE_EVERY === 0
          ) {
            this.modelIdx = (this.modelIdx + 1) % this.openrouterModels.length;
            rotatedModel = this.openrouterModels[this.modelIdx];
            logger.warn?.(`[AiGateway] 429 streak x${streak429} — rotating OpenRouter model to ${rotatedModel}`);
          }
          key.failures++;
          key.lastFailureAt = Date.now();
          const cd = Math.min(retryAfter ?? 60_000 * Math.pow(2, Math.min(key.failures - 1, 3)), 600_000);
          key.cooldownUntil = Date.now() + cd;
          key.lastError = `429 retry ${attempt + 1}/${maxAttempts}${rotatedModel ? ` (${rotatedModel})` : ''} — rotated to next key`;
          // Standardized backoff: 0.8s, 1.6s, 3.2s cap 5s — max 3 attempts total, then fail fast.
          if (attempt < maxAttempts - 1) {
            const backoff = Math.min(retryAfter ?? 800 * Math.pow(2, attempt), 5_000);
            logger.warn?.(`[AiGateway] 429 on ${key.id}, retry ${attempt + 1}/${maxAttempts} after ${backoff}ms`);
            await sleep(backoff);
            continue;
          }
          emitFailure(key, err);
          const e2: any = new Error(`HTTP 429: Rate-limited (retry after ${Math.round((retryAfter ?? 60_000)/1000)}s)`);
          e2.status = 429; e2.retryAfter = retryAfter ?? 60_000;
          throw e2;
        }
        emitFailure(key, err);
        const retryAfter = this.extractRetryAfter(err);
        const cooldown = this.pool.reportFailure(key, err, retryAfter);
        logger.warn?.(`[AiGateway] attempt ${attempt + 1}/${maxAttempts} failed on ${key.id}: ${err instanceof Error ? err.message : String(err)}`);
        if (cooldown > 0 && attempt < maxAttempts - 1) {
          await sleep(Math.min(cooldown, 5_000));
        }
      }
    }
    throw new AiGatewayError(`All AI keys exhausted after ${maxAttempts} attempts`, lastErr, maxAttempts);
  }

  /** Streaming: yields content/reasoning/tool deltas via SSE (OpenAI `stream:true`). */
  async *stream(req: CompletionRequest): AsyncGenerator<{ contentDelta?: string; reasoningDelta?: string; toolCallDelta?: any[]; finishReason?: string; usage?: any }, void, unknown> {
    const startedAt = Date.now();
    let firstTokenAt = 0;
    // Skip a flagged-down model outright (mirrors complete()'s entry check
    // — most turns never pay the probe).
    const requestedFlaky = req.model && FALLBACK_MODEL[req.model] ? req.model : null;
    if (requestedFlaky && (await modelFlagged(requestedFlaky))) {
      logger.warn?.(`[AiGateway] stream: ${requestedFlaky} flagged down — starting on ${FALLBACK_MODEL[requestedFlaky]}`);
      req = { ...req, model: FALLBACK_MODEL[requestedFlaky] };
    }
    // Unflagged flaky model: first-data probe (probeTimeoutMs) — give up fast
    // when the model sends NOTHING at all, but never strangle a stream that
    // has started flowing. Flagged/fine models stream under the full timeoutMs.
    const probing = !!requestedFlaky && req.model === requestedFlaky && !!req.probeTimeoutMs;
    const streamCap = req.timeoutMs;
    const probeMs = probing ? req.probeTimeoutMs : undefined;
    const key = req.keyId ? this.findKey(req.keyId) ?? this.pool.select(req.provider, req.sessionKey) : this.pool.select(req.provider, req.sessionKey);
    if (!key) throw new AiGatewayError('No AI key available (pool empty or all disabled)');
    const provider = PROVIDERS[key.provider] ?? PROVIDERS.groq;
    const wantsVision = req.messages.some((m) => Array.isArray(m.content));
    const model = req.model || (wantsVision ? this.visionModelOverride || provider.visionModel || provider.defaultModel : provider.defaultModel);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${key.key}`, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
    // Founder rule (2026-11-27): every call runs to the model's own maximum
    // output — max_tokens is never sent; req.maxTokens is intentionally ignored.
    const body: Record<string, unknown> = {
      model, messages: req.messages, temperature: req.temperature ?? 0.2,
      ...(Array.isArray(req.tools) && req.tools.length > 0 ? { tools: req.tools } : {}),
      ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
      ...provider.extraParams, ...(req.extraParams ?? {}), stream: true,
    };
    if (req.json && provider.jsonMode) body.response_format = provider.jsonMode;
    if (provider.reasoningObject && !req.reasoningOff) (body as any).reasoning = { enabled: true };
    else if (provider.supportsReasoning && req.reasoningEffort && !req.reasoningOff) (body as any).reasoning_effort = req.reasoningEffort;
    const url = this.gatewayBaseURL(provider);
    const payload = JSON.stringify(body);
    // Direct egress for streams — a single attempt; failures surface to the
    // caller (runTurn falls back to non-streaming across the chain).
    let res: Response | null = null;
    try {
      res = await fetch(url, { method: 'POST', headers, body: payload, signal: this.combineSignals(req.signal, streamCap) });
    } catch (e) {
      // Caller aborted (tab closed / playground Stop): not a provider fault.
      if ((e as any)?.name === 'AbortError') throw e;
      const timedOut = (e as any)?.name === 'TimeoutError' || /timeout/i.test(String((e as any)?.message ?? ''));
      if (timedOut && req.model && FALLBACK_MODEL[req.model]) {
        await flagModelDown(req.model);
        const err = new Error(`AI model ${req.model} timed out (fallback to ${FALLBACK_MODEL[req.model]} engaged) — retry the call`);
        emitGatewayMetric({
          provider: key.provider, keyId: key.id, ok: false, status: null,
          errorKind: "timeout", latencyMs: Date.now() - startedAt, streamed: true,
          source: metricSource(req),
        });
        throw err;
      }
      emitGatewayMetric({
        provider: key.provider, keyId: key.id, ok: false, status: null,
        errorKind: classifyGatewayError(null, String((e as any)?.message ?? e)),
        latencyMs: Date.now() - startedAt, streamed: true, source: metricSource(req),
      });
      throw e;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err: any = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status; err.retryAfter = this.parseRetryAfter(res.headers);
      // Feed pool health so the next turn rotates away from a 429'd key.
      try { this.pool.reportFailure(key, err, err.retryAfter); } catch {}
      emitGatewayMetric({
        provider: key.provider, keyId: key.id, ok: false, status: res.status,
        errorKind: classifyGatewayError(res.status, err.message),
        latencyMs: Date.now() - startedAt, streamed: true, source: metricSource(req),
      });
      throw err;
    }
    if (!res.body) return;
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let gotData = false;
    // Last provider-reported token usage seen on this stream (OpenRouter
    // sends `usage` on the final chunk). Logged once the consumer drains
    // the stream — streamTurn always consumes to completion, and the await
    // below guarantees the KV write lands before the isolate freezes.
    let lastUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;
    // Probe failure: the model sent nothing before the first-data deadline —
    // flag it down (caller falls back to the fallback model) and throw a
    // retryable error shaped like the whole-stream timeout below.
    const failProbe = async (): Promise<never> => {
      try { await reader.cancel(); } catch { /* ignore */ }
      if (req.model && FALLBACK_MODEL[req.model]) await flagModelDown(req.model);
      // The read-loop catch below records this timeout exactly once.
      throw new Error(`AI model ${req.model} first token timeout (fallback to ${req.model && FALLBACK_MODEL[req.model]} engaged) — retry the call`);
    };
    try {
      // First-data deadline: abort only while NOTHING has arrived yet. A
      // stalled model fails fast onto the fallback; a flowing stream is never
      // strangled no matter how long the answer runs.
      const firstDataDeadline = probeMs ? Date.now() + probeMs : 0;
      while (true) {
        let read: Awaited<ReturnType<typeof reader.read>> | undefined;
        if (firstDataDeadline > 0 && !gotData) {
          const remain = firstDataDeadline - Date.now();
          if (remain <= 0) {
            await failProbe();
            continue;
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            read = await Promise.race([
              reader.read(),
              new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('probe-timeout')), remain); }),
            ]);
          } catch (e: any) {
            if (e?.message === 'probe-timeout') {
              await failProbe();
              continue;
            }
            throw e;
          } finally {
            if (timer) clearTimeout(timer);
          }
        } else {
          read = await reader.read();
        }
        if (!read || read.done) break;
        buf += decoder.decode(read.value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]' || data === '') continue;
          gotData = true;
          try {
            const json: any = JSON.parse(data);
            const choice = json.choices?.[0];
            if (!choice) { if (json.usage) { lastUsage = json.usage; yield { usage: json.usage }; } continue; }
            const delta = choice.delta ?? {};
            if (!firstTokenAt && (delta.content || delta.reasoning_content || delta.reasoning)) firstTokenAt = Date.now() - startedAt;
            if (typeof delta.content === 'string' && delta.content) yield { contentDelta: delta.content };
            if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) yield { reasoningDelta: delta.reasoning_content };
            // OpenRouter/DeepSeek streams thinking as `delta.reasoning` (NOT
            // `reasoning_content`) — without this the chat "Thinking" UI gets
            // nothing on the paid lane.
            if (typeof delta.reasoning === 'string' && delta.reasoning) yield { reasoningDelta: delta.reasoning };
            if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) yield { toolCallDelta: delta.tool_calls };
            if (choice.finish_reason) yield { finishReason: choice.finish_reason };
            if (json.usage) { lastUsage = json.usage; yield { usage: json.usage }; }
          } catch { /* ignore parse */ }
        }
      }
    } catch (e) {
      if ((e as any)?.name === 'AbortError') throw e;
      emitGatewayMetric({
        provider: key.provider, keyId: key.id, ok: false, status: null,
        errorKind: classifyGatewayError(null, String((e as any)?.message ?? e)),
        latencyMs: Date.now() - startedAt, ttftMs: firstTokenAt || null, streamed: true,
        source: metricSource(req),
      });
      throw e;
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    this.pool.reportSuccess(key);
    // Same audit for streams (chat serves streamed turns — without this,
    // streamed legs are invisible in the tail).
    logger.info?.(`[AiGateway] stream served by ${key.id} (${provider.id}/${model})`);
    if (lastUsage) await logGatewayUsage(lastUsage);
    emitGatewayMetric({
      provider: key.provider, keyId: key.id, ok: true, status: 200,
      latencyMs: Date.now() - startedAt, ttftMs: firstTokenAt || null, streamed: true,
      promptTokens: lastUsage?.prompt_tokens ?? null,
      completionTokens: lastUsage?.completion_tokens ?? null,
      totalTokens: lastUsage?.total_tokens ?? null,
      source: metricSource(req),
    });
  }

  /** Convenience: complete + parse JSON (falls back to extracting the first
   *  JSON object/array when the model wraps it in prose — providers without
   *  structured-output support need this). */
  async completeJson<T = unknown>(req: CompletionRequest): Promise<T> {
    const res = await this.complete({ ...req, json: true });
    try {
      return JSON.parse(res.content) as T;
    } catch {
      const extracted = extractJson(res.content);
      if (extracted !== null) return extracted as T;
      throw new AiGatewayError(`Failed to parse JSON from ${res.provider} response: ${res.content.slice(0, 200)}`);
    }
  }

  private findKey(id: string): AiKey | null {
    return (this.pool as any)['keys']?.find((k: AiKey) => k.id === id) ?? null;
  }

  private async callProvider(
    provider: ProviderConfig,
    key: AiKey,
    req: CompletionRequest,
  ): Promise<CompletionResult> {
    // Vision routing: image parts need the vision-capable model (text default
    // can't see images). Explicit req.model always wins; VISION_MODEL env
    // overrides the provider default.
    const wantsVision = req.messages.some((m) => Array.isArray(m.content));
    const model = req.model || (wantsVision ? this.visionModelOverride || provider.visionModel || provider.defaultModel : provider.defaultModel);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key.key}`,
      // Browser-like UA: some providers/WAFs block bare Workers/undici UAs.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    // Founder rule (2026-11-27): every call runs to the model's own maximum
    // output — max_tokens is never sent; req.maxTokens is intentionally ignored.
    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
      ...(Array.isArray(req.tools) && req.tools.length > 0 ? { tools: req.tools } : {}),
      ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
      ...provider.extraParams,
      ...(req.extraParams ?? {}),
    };
    if (req.json && provider.jsonMode) {
      body.response_format = provider.jsonMode;
    }
    if (provider.reasoningObject && !req.reasoningOff) {
      // OpenRouter-style reasoning switch (ling models etc.).
      body.reasoning = { enabled: true };
    } else if (provider.supportsReasoning && req.reasoningEffort && !req.reasoningOff) {
      body.reasoning_effort = req.reasoningEffort;
    }
    const payload = JSON.stringify(body);
    // Direct OpenAI-compatible call — the single gateway has no lanes,
    // tunnels, or per-provider egress paths. Failures return to complete()
    // for key rotation + retry.
    const url = this.gatewayBaseURL(provider);
    const res = await fetch(url, { method: 'POST', headers, body: payload, signal: this.combineSignals(req.signal, req.timeoutMs) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err: any = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      err.retryAfter = this.parseRetryAfter(res.headers);
      throw err;
    }
    const data: any = await res.json();
    const msg: any = data?.choices?.[0]?.message ?? {};
    const rawContent: unknown = msg?.content ?? '';
    // Some vision models return content as parts — flatten to text.
    const content: string = typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('')
        : '';
    const toolCalls: ToolCall[] | undefined = Array.isArray(msg?.tool_calls)
      ? msg.tool_calls
        .filter((t: any) => t?.function?.name)
        .map((t: any) => ({
          id: String(t?.id ?? ''),
          name: String(t.function.name),
          arguments: typeof t.function.arguments === 'string' ? t.function.arguments : JSON.stringify(t.function.arguments ?? {}),
        }))
      : undefined;
    const reasoning: string = typeof msg?.reasoning === 'string' ? msg.reasoning : '';
    const finishReason: string = typeof data?.choices?.[0]?.finish_reason === 'string' ? data.choices[0].finish_reason : '';
    return {
      content, provider: key.provider, keyId: key.id, model,
      jsonParsed: !!req.json, usage: data?.usage,
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(finishReason ? { finishReason } : {}),
    };
  }

  /** Merge caller abort + per-attempt timeout into one signal (edge-safe). */
  private combineSignals(signal: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal | undefined {
    if (!timeoutMs || timeoutMs <= 0) return signal;
    try {
      const t = AbortSignal.timeout(timeoutMs);
      if (!signal) return t;
      if (typeof (AbortSignal as any).any === 'function') return (AbortSignal as any).any([signal, t]);
      return signal;
    } catch {
      return signal;
    }
  }

  private extractRetryAfter(err: unknown): number | undefined {    if (err && typeof err === 'object') {
      return (err as any).retryAfter;
    }
    return undefined;
  }

  private parseRetryAfter(headers: Headers): number | undefined {
    const v = headers.get('retry-after') || headers.get('x-ratelimit-reset');
    if (!v) return undefined;
    const secs = Number(v);
    return Number.isFinite(secs) ? secs * 1000 : undefined;
  }
}
