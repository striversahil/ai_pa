// Extracted verbatim from ai-gateway.ts by scripts/refactor/split-module.mjs.
// ai-gateway.ts re-exports everything public here, so existing imports keep working.
import { cacheGet, cacheSet, cacheKeys } from "../cache";
import { logger } from "../logger";
import { gatewayUsageKey, GATEWAY_USAGE_TTL_MS, GATEWAY_USAGE_PREFIX, MODEL_DOWN_TTL_MS, KeyPool, PROVIDERS, hashAI, FALLBACK_MODEL, AiGatewayError, extractJson, DEFAULT_TTFT_MS, DEFAULT_FIRST_BYTE_MS, DEFAULT_ATTEMPT_TIMEOUT_MS, DEFAULT_STREAM_TIMEOUT_MS, MAX_ATTEMPTS } from "./pure";
import { emitGatewayMetric, classifyGatewayError, metricSource } from "./metrics";
import type { KeyHealth, ProviderConfig, CompletionRequest, CompletionResult, AiKey, ToolCall } from "./types";

/** First-byte budget for the buffered retry of a refused stream. The buffered
 *  form only emits its first byte when the whole answer is ready, so a big
 *  split legitimately takes 60-90 s there. */
const BUFFERED_JSON_TTFT_MS = 90_000;

/** Parse a JSON answer, tolerating prose around it. Shared by the buffered and
 *  the streamed paths so both fail with the same message shape. */
function parseGatewayJson<T>(content: string, mode: 'buffered' | 'streamed'): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    const extracted = extractJson(content);
    if (extracted !== null) return extracted as T;
    throw new AiGatewayError(`Failed to parse JSON from ${mode} response: ${content.slice(0, 200)}`);
  }
}

/** True when the stream failed for a reason the BUFFERED call may survive:
 *  a provider-side refusal (5xx/404) or a transport death, never a plain
 *  429/401 (the pool is throttled or the key is dead either way). */
function streamsRefused(e: unknown): boolean {
  let cur: any = e;
  for (let hop = 0; cur && hop < 3; hop++) {
    const status = Number(cur.status) || 0;
    if (status >= 500 || status === 404) return true;
    if (!status && /fetch failed|network|terminated|no body|ECONNRESET/i.test(String(cur.message ?? ''))) return true;
    cur = cur.cause ?? cur.lastErr ?? null;
  }
  return false;
}

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
  // Cloudflare AI Gateway (standardized): when CLOUDFLARE_ACCOUNT_ID + CF_AIG_GATEWAY_ID are set,
  // all providers route via https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/...
  // as reverse proxy with caching/rate-limiting/logging. Custom providers use `custom-{slug}`.
  private aigAccount = '';
  private aigGateway = '';

  constructor(env?: Record<string, unknown>) {
    if (env) this.configure(env);
  }

  /** Env is used ONLY for transport settings (CF AI Gateway proxy + vision
   *  override). AI keys/providers come exclusively from Setting
   *  `ai:providers` via configureFromSettings() — founder decision
   *  2026-11-27. Never load AI_KEYS or provider keys here. */
  configure(env: Record<string, unknown>): void {
    const v = String((env as any)?.VISION_MODEL ?? '').trim();
    if (v) this.visionModelOverride = v;
    const aigAcc = String((env as any)?.CLOUDFLARE_ACCOUNT_ID ?? (env as any)?.CF_AIG_ACCOUNT_ID ?? '').trim();
    const aigId = String((env as any)?.CF_AIG_GATEWAY_ID ?? (env as any)?.AI_GATEWAY_ID ?? 'founder-os').trim();
    if (aigAcc) { this.aigAccount = aigAcc; this.aigGateway = aigId; }
  }

  get keyCount(): number {
    return this.pool.size;
  }

  /** Apply runtime Setting config (ai:strategy + ai:providers JSON).
   *  The Setting is the WHOLE pool: keys no longer present are pruned, so a
   *  provider/key deleted in Settings disappears even in a warm isolate.
   *  Malformed JSON fails OPEN (keeps the last good pool) so a corrupted
   *  Setting cannot take every AI path down; a valid empty list clears it. */
  configureFromSettings(settings: Record<string, string>): void {
    try {
      const s = String(settings?.['ai:strategy'] ?? '').trim();
      if (s === 'round-robin' || s === 'least-used-first') this.pool.setStrategy(s);
    } catch { /* ignore */ }
    try {
      const raw = String(settings?.['ai:providers'] ?? '').trim();
      if (!raw) { this.pool.retainKeys(new Set()); return; }
      let parsed: any;
      try { parsed = JSON.parse(raw); } catch { return; }
      const list = Array.isArray(parsed) ? parsed : parsed?.providers;
      if (!Array.isArray(list)) return;
      if (typeof parsed?.strategy === 'string') {
        const ps = String(parsed.strategy).trim();
        if (ps === 'round-robin' || ps === 'least-used-first') this.pool.setStrategy(ps);
      }
      const keep = new Set<string>();
      for (const p of list.slice(0, 20)) {
        const id = String(p?.id ?? '').trim();
        const baseUrl = String(p?.baseUrl ?? p?.baseURL ?? '').trim();
        const model = String(p?.model ?? '').trim();
        const keys = Array.isArray(p?.keys) ? p.keys : [];
        if (!id || !baseUrl || !model || keys.length === 0) continue;
        const use = keys.slice(0, 10);
        this.pool.registerProvider(id, baseUrl, model, use, p?.enabled !== false);
        for (const k of use) {
          const kv = String((k as any)?.key ?? '').trim();
          if (kv) keep.add(kv);
        }
      }
      this.pool.retainKeys(keep);
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
        const prov = req.provider || 'pool';
        const model = req.model || PROVIDERS[prov]?.defaultModel || '';
        const keyRaw = JSON.stringify({ prov, model, messages: req.messages, temperature: req.temperature ?? 0.2, json: !!req.json });
        aiCacheKey = `ai:resp:${hashAI(keyRaw)}`;
        const hit = await cacheGet<CompletionResult>(aiCacheKey, 5 * 60 * 1000);
        if (hit) { logger.info?.(`[AiGateway] cache hit ${aiCacheKey.slice(0, 24)}`); return hit; }
      } catch {}
    }
    // Failover policy (2026-11-27): one fresh key per attempt, immediate
    // rotation on failure/timeout (never sleep while a user waits), and a
    // pinned key (playground) is probed exactly once. Pool-wide requests get
    // up to 6 tries; a pinned provider leg gets 3 so the caller's chain moves
    // on to the next API. A total budget stops a run of slow providers.
    const maxAttempts = req.keyId
      ? 1
      : Math.max(1, Number(req.maxAttempts) || (req.provider ? 3 : MAX_ATTEMPTS));
    const totalBudgetMs = Math.max(1_000, Number(req.totalTimeoutMs) || (req.provider ? 120_000 : 300_000));
    const deadline = startedAt + totalBudgetMs;
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
      if (Date.now() >= deadline) break;
      const key = req.keyId
        ? this.findKey(req.keyId) ?? this.pool.select(req.provider, req.sessionKey, req.ignoreCooldown === true)
        : this.pool.select(req.provider, req.sessionKey, req.ignoreCooldown === true);
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
      const provider = PROVIDERS[key.provider];
      if (!provider) {
        throw new AiGatewayError(`AI provider "${key.provider}" is not configured in Settings`, undefined, attempt + 1);
      }
      try {
        const modelOverride = activeModel && activeModel !== req.model ? activeModel : undefined;
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
        // A caller-side cancel/timeout is not a provider fault: never cool or
        // disable a key because the browser closed the tab.
        if (req.signal?.aborted) throw err;
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
          // A pinned probe (playground) reports its result; it must not mutate
          // the production pool (the operator decides what to disable).
          if (!req.keyId) {
            key.failures++;
            key.lastFailureAt = Date.now();
            const cd = Math.min(retryAfter ?? 60_000 * Math.pow(2, Math.min(key.failures - 1, 3)), 600_000);
            key.cooldownUntil = Date.now() + cd;
          }
          key.lastError = `429 retry ${attempt + 1}/${maxAttempts} — rotated to next key`;
          // Standardized backoff: 0.8s, 1.6s, 3.2s cap 5s — max 3 attempts total, then fail fast.
          emitFailure(key, err);
          if (attempt < maxAttempts - 1) {
            logger.warn?.(`[AiGateway] 429 on ${key.id}, rotating immediately to the next key (attempt ${attempt + 1}/${maxAttempts})`);
            continue;
          }
          const e2: any = new Error(`HTTP 429: Rate-limited (retry after ${Math.round((retryAfter ?? 60_000)/1000)}s)`);
          e2.status = 429; e2.retryAfter = retryAfter ?? 60_000;
          throw e2;
        }
        emitFailure(key, err);
        if (!req.keyId) this.pool.reportFailure(key, err, this.extractRetryAfter(err));
        logger.warn?.(`[AiGateway] attempt ${attempt + 1}/${maxAttempts} failed on ${key.id}: ${err instanceof Error ? err.message : String(err)} — immediate failover`);
      }
    }
    throw new AiGatewayError(`All AI keys exhausted after ${maxAttempts} attempts`, lastErr, maxAttempts);
  }

  /** Streaming: yields content/reasoning/tool deltas via SSE (OpenAI stream:true).
   *
   *  Failover (2026-11-27): each attempt gets a first-token deadline
   *  (ttftMs, default 20 s) and an overall cap (timeoutMs, default 120 s).
   *  A non-OK response, network error, or first-token timeout cools that key
   *  and rotates to the next API immediately — but only while NOTHING has been
   *  delivered (after the first delta a retry would duplicate output).
   *  A pinned keyId (Settings playground) is probed exactly once, no rotation.
   */
  async *stream(req: CompletionRequest): AsyncGenerator<{ contentDelta?: string; reasoningDelta?: string; toolCallDelta?: any[]; finishReason?: string; usage?: any }, void, unknown> {
    const startedAt = Date.now();
    // Keep complete()'s flagged-model skip: most turns never pay the probe.
    const requestedFlaky = req.model && FALLBACK_MODEL[req.model] ? req.model : null;
    if (requestedFlaky && (await modelFlagged(requestedFlaky))) {
      logger.warn?.('[AiGateway] stream: ' + requestedFlaky + ' flagged down — starting on ' + FALLBACK_MODEL[requestedFlaky]);
      req = { ...req, model: FALLBACK_MODEL[requestedFlaky] };
    }
    const wantsVision = req.messages.some((m) => Array.isArray(m.content));
    // One fresh key per attempt. A pinned key is a probe (exactly one try);
    // a provider leg gets 3 tries so the caller's chain moves on quickly.
    const maxAttempts = req.keyId ? 1 : Math.max(1, Number(req.maxAttempts) || (req.provider ? 3 : MAX_ATTEMPTS));
    const totalBudget = Math.max(1_000, Number(req.totalTimeoutMs) || (req.provider ? 120_000 : 300_000));
    const deadline = startedAt + totalBudget;
    let lastErr: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (Date.now() >= deadline) break;
      const attemptStartedAt = Date.now();
      const key = req.keyId ? this.findKey(req.keyId) ?? this.pool.select(req.provider, req.sessionKey) : this.pool.select(req.provider, req.sessionKey);
      if (!key) {
        if (attempt === 0) throw new AiGatewayError('No AI key available (pool empty or all disabled)');
        break;
      }
      const provider = PROVIDERS[key.provider];
      if (!provider) throw new AiGatewayError(`AI provider "${key.provider}" is not configured in Settings`);
      const model = req.model || (wantsVision ? this.visionModelOverride || provider.visionModel || provider.defaultModel : provider.defaultModel);
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key.key, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
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

      const ctrl = new AbortController();
      const caller = req.signal;
      let callerAborted = !!caller?.aborted;
      const onCallerAbort = () => { callerAborted = true; try { ctrl.abort(); } catch { /* ignore */ } };
      if (caller) caller.addEventListener('abort', onCallerAbort, { once: true });
      const streamCap = Number(req.timeoutMs) > 0 ? Number(req.timeoutMs) : DEFAULT_STREAM_TIMEOUT_MS;
      const capTimer = setTimeout(() => ctrl.abort(this.timeoutError('AI stream timeout')), streamCap);
      const ttftMs = Number(req.ttftMs) > 0 ? Number(req.ttftMs) : DEFAULT_TTFT_MS;
      let ttftTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(
        () => ctrl.abort(this.timeoutError('AI first-token timeout')), ttftMs,
      );
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let delivered = false;
      let lastUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;
      let firstTokenAt = 0;
      const cleanup = () => {
        if (ttftTimer) { clearTimeout(ttftTimer); ttftTimer = undefined; }
        clearTimeout(capTimer);
        caller?.removeEventListener('abort', onCallerAbort);
      };

      try {
        if (callerAborted) {
          const e: any = new Error('Aborted'); e.name = 'AbortError'; throw e;
        }
        const res = await fetch(url, { method: 'POST', headers, body: payload, signal: ctrl.signal });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const err: any = new Error('HTTP ' + res.status + ': ' + text.slice(0, 300));
          err.status = res.status;
          err.retryAfter = this.parseRetryAfter(res.headers);
          throw err;
        }
        if (!res.body) throw new Error('AI stream returned no body');
        reader = (res.body as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const read = await reader.read();
          if (!read || read.done) break;
          buf += decoder.decode(read.value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]' || data === '') continue;
            // Data is flowing: the model is alive. Keep the overall cap only.
            if (ttftTimer) { clearTimeout(ttftTimer); ttftTimer = undefined; }
            try {
              const json: any = JSON.parse(data);
              const choice = json.choices?.[0];
              if (!choice) { if (json.usage) { lastUsage = json.usage; yield { usage: json.usage }; } continue; }
              const delta = choice.delta ?? {};
              if (!firstTokenAt && (delta.content || delta.reasoning_content || delta.reasoning)) firstTokenAt = Date.now() - attemptStartedAt;
              if (typeof delta.content === 'string' && delta.content) { delivered = true; yield { contentDelta: delta.content }; }
              if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) { delivered = true; yield { reasoningDelta: delta.reasoning_content }; }
              // Some providers stream thinking as delta.reasoning (NOT
              // reasoning_content) — without this the chat "Thinking" UI gets
              // nothing.
              if (typeof delta.reasoning === 'string' && delta.reasoning) { delivered = true; yield { reasoningDelta: delta.reasoning }; }
              if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) { delivered = true; yield { toolCallDelta: delta.tool_calls }; }
              if (choice.finish_reason) { delivered = true; yield { finishReason: choice.finish_reason }; }
              if (json.usage) { lastUsage = json.usage; yield { usage: json.usage }; }
            } catch { /* ignore parse */ }
          }
        }
        this.pool.reportSuccess(key);
        logger.info?.('[AiGateway] stream served by ' + key.id + ' (' + provider.id + '/' + model + ')');
        if (lastUsage) await logGatewayUsage(lastUsage);
        emitGatewayMetric({
          provider: key.provider, keyId: key.id, ok: true, status: 200,
          latencyMs: Date.now() - attemptStartedAt, ttftMs: firstTokenAt || null, streamed: true,
          promptTokens: lastUsage?.prompt_tokens ?? null,
          completionTokens: lastUsage?.completion_tokens ?? null,
          totalTokens: lastUsage?.total_tokens ?? null,
          source: metricSource(req),
        });
        return;
      } catch (e: any) {
        // Caller cancel/stop is not a provider fault.
        if (callerAborted || caller?.aborted) throw e;
        const timedOut = ctrl.signal.aborted;
        const err = timedOut ? ((ctrl.signal.reason as Error) ?? this.timeoutError('AI stream timeout')) : e;
        emitGatewayMetric({
          provider: key.provider, keyId: key.id, ok: false, status: Number((e as any)?.status) || null,
          errorKind: classifyGatewayError(Number((e as any)?.status) || null, String((err as any)?.message ?? err)),
          latencyMs: Date.now() - attemptStartedAt, ttftMs: firstTokenAt || null, streamed: true,
          source: metricSource(req),
        });
        if (!req.keyId) this.pool.reportFailure(key, err);
        lastErr = err;
        const tail = delivered ? ' (after delivery — no retry)' : ' — immediate failover';
        logger.warn?.('[AiGateway] stream attempt ' + (attempt + 1) + '/' + maxAttempts + ' failed on ' + key.id + ': ' + String((err as any)?.message ?? err) + tail);
        if (!delivered) continue;
        throw err;
      } finally {
        cleanup();
        try { ctrl.abort(); } catch { /* ignore */ }
        try { reader?.releaseLock(); } catch { /* ignore */ }
      }
    }
    throw new AiGatewayError('All AI keys exhausted after ' + maxAttempts + ' stream attempts', lastErr, maxAttempts);
  }

  /** Convenience: complete + parse JSON (falls back to extracting the first
   *  JSON object/array when the model wraps it in prose — providers without
   *  structured-output support need this). */
  async completeJson<T = unknown>(req: CompletionRequest): Promise<T> {
    const res = await this.complete({ ...req, json: true });
    return parseGatewayJson<T>(res.content, 'buffered');
  }

  /** Convenience: STREAM the call, assemble the text, parse it as JSON.
   *
   *  Non-streaming completions make the provider buffer the whole answer
   *  before the first byte arrives, so `complete()`'s first-byte deadline
   *  fires on every real enquiry: a 20-line split takes 60-90 s (measured
   *  66 s for a 1k-char text on the configured free model — the same call
   *  streamed yields its first token in 6 s and finishes in 21 s). Split and
   *  extraction prompts therefore ride the stream path: same body, same
   *  failover/telemetry, same parsed result, but a real time-to-first-token
   *  instead of a fake one. */
  async completeJsonStream<T = unknown>(req: CompletionRequest): Promise<T> {
    let content = '';
    let delivered = false;
    try {
      for await (const chunk of this.stream({ ...req, json: true })) {
        if (chunk.contentDelta) { content += chunk.contentDelta; delivered = true; }
      }
    } catch (e) {
      // A provider can refuse the STREAMED form while its buffered form
      // answers: on 2026-11-27 every streamed call to the configured free
      // endpoint came back 503 "service is busy" in ~5 s while 5 of 6
      // identical buffered calls were served. Nothing was delivered, so one
      // buffered attempt is a different leg, not a retry of a dead stream.
      if (delivered || !streamsRefused(e)) throw e;
      console.warn('[AiGateway] stream refused before content — retrying buffered: ' + String((e as any)?.message ?? e).slice(0, 180));
      const res = await this.complete({
        ...req,
        json: true,
        ignoreCooldown: true,
        ttftMs: Math.max(Number(req.ttftMs) || 0, BUFFERED_JSON_TTFT_MS),
      });
      return parseGatewayJson<T>(res.content, 'buffered');
    }
    return parseGatewayJson<T>(content, 'streamed');
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
      // OpenAI-compatible reasoning switch.
      body.reasoning = { enabled: true };
    } else if (provider.supportsReasoning && req.reasoningEffort && !req.reasoningOff) {
      body.reasoning_effort = req.reasoningEffort;
    }
    const payload = JSON.stringify(body);
    // Direct OpenAI-compatible call — the single gateway has no lanes,
    // tunnels, or per-provider egress paths. Failures return to complete()
    // for key rotation + retry.
    //
    // Per-attempt abort (2026-11-27): caller cancel + first-byte deadline
    // (headers) + total attempt cap. A provider that accepts the socket but
    // never answers must not hold the user's enquiry hostage — abort, cool
    // that key, and rotate to the next API immediately.
    const url = this.gatewayBaseURL(provider);
    const ctrl = new AbortController();
    const caller = req.signal;
    const onCallerAbort = () => { try { ctrl.abort((caller as any)?.reason); } catch { ctrl.abort(); } };
    if (caller) {
      if (caller.aborted) onCallerAbort();
      else caller.addEventListener('abort', onCallerAbort, { once: true });
    }
    const waitStartedAt = Date.now();
    const firstByteMs = Number(req.ttftMs) > 0 ? Number(req.ttftMs) : DEFAULT_FIRST_BYTE_MS;
    const attemptCapMs = Number(req.timeoutMs) > 0 ? Number(req.timeoutMs) : DEFAULT_ATTEMPT_TIMEOUT_MS;
    let firstByteTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => ctrl.abort(this.timeoutError('AI first-byte timeout')), firstByteMs,
    );
    let capTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanupTimers = () => {
      if (firstByteTimer) { clearTimeout(firstByteTimer); firstByteTimer = undefined; }
      if (capTimer) { clearTimeout(capTimer); capTimer = undefined; }
      caller?.removeEventListener('abort', onCallerAbort);
    };
    let data: any;
    try {
      const res = await fetch(url, { method: 'POST', headers, body: payload, signal: ctrl.signal });
      if (firstByteTimer) { clearTimeout(firstByteTimer); firstByteTimer = undefined; }
      capTimer = setTimeout(
        () => ctrl.abort(this.timeoutError('AI call timeout')),
        Math.max(1, attemptCapMs - (Date.now() - waitStartedAt)),
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err: any = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
        err.status = res.status;
        err.retryAfter = this.parseRetryAfter(res.headers);
        throw err;
      }
      data = await res.json();
    } catch (e: any) {
      // The caller's own abort/cancel stays an AbortError (never a key fault).
      if (caller?.aborted) throw e;
      if (ctrl.signal.aborted) throw (ctrl.signal.reason ?? this.timeoutError('AI call aborted'));
      throw e;
    } finally {
      cleanupTimers();
    }
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

  /** Error name 'TimeoutError' so callers/metrics classify timeouts as such. */
  private timeoutError(message: string): Error {
    const e: any = new Error(message);
    e.name = 'TimeoutError';
    return e;
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
