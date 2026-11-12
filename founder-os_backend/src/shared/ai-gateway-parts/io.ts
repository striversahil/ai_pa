// Extracted verbatim from ai-gateway.ts by scripts/refactor/split-module.mjs.
// ai-gateway.ts re-exports everything public here, so existing imports keep working.
import { cacheGet, cacheSet, cacheKeys } from "../cache";
import { logger } from "../logger";
import { gatewayUsageKey, GATEWAY_USAGE_TTL_MS, GATEWAY_USAGE_PREFIX, MODEL_DOWN_TTL_MS, KeyPool, OPENROUTER_TEXT_MODEL, RELAY_ACTIVE_KEY, RELAY_POISONED_KEY, RELAY_ACTIVE_KEY_BAK, RELAY_POISONED_KEY_BAK, RELAY_TTL_MS, RELAY_MEMO_MS, RELAY_POISONED_TTL_MS, PROVIDERS, hashAI, FALLBACK_MODEL, sleep, AiGatewayError, extractJson } from "./pure";
import type { ProxyLane, KeyHealth, ProviderConfig, CompletionRequest, CompletionResult, AiKey, ToolCall } from "./types";

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
  // as reverse proxy with caching/rate-limiting/logging. Custom providers (agnes, openrouter) use `custom-{slug}`.
  private aigAccount = '';
  private aigGateway = '';
  // Egress-relay proxy (Agnes only — the 1015-throttled provider).
  // AGNES_PROXY_URL points at the relay's STATIC named-tunnel hostname
  // (e.g. https://egress-gh.apotza.com). Two lanes share this slot:
  //  - on-demand GH relay: used ONLY while KV `ai:relay:active` is fresh
  //    (the relay run registers itself via POST /api/runner/relay/register
  //    and heartbeats; TTL ~6h bounds cost when a run dies). Flag absent →
  //    direct egress only, zero overhead.
  //  - always-on home/GCP lane: set AGNES_PROXY_ALWAYS=1 to skip the gate.
  // Proxy faults (unreachable/timeout/tunnel-down 502) fall through to
  // direct with zero pool penalty. A proxy 429 is a REAL upstream answer.
  // Proxied calls intentionally bypass the CF AI Gateway (same shared-egress
  // fate). Runners (scripts/ai-gateway.js) don't read these vars — GitHub
  // egress is clean.
  private lanes: ProxyLane[] = [];
  // Proxy attempt cap: high enough for legit reasoning responses (they take
  // 6–15s), low enough to bound a dead tunnel. A down PC fails FAST anyway
  // (refused/DNS, milliseconds) — this cap only binds genuine stalls.
  private proxyTimeoutMs = 25000;
  // Flaky-PC guard (per isolate): after 3 consecutive proxy faults, skip the
  // proxy for 60s instead of paying the timeout on every attempt. Success
  // resets the streak. (Cross-isolate learning would need KV — the timeout
  // cap already bounds the worst case, so local memory suffices.)
  // Always-on lane escape hatch (home PC / GCP VM): skip the relay gate.
  private proxyAlways = false;

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
    const mkLane = (
      name: string, urlRaw: unknown, secRaw: unknown, activeKey: string, poisonedKey: string,
    ): ProxyLane | null => {
      const url = String(urlRaw ?? '').trim().replace(/\/+$/, '');
      const secret = String(secRaw ?? '').trim();
      if (!url || !secret) return null;
      const prev = this.lanes.find((l) => l.name === name);
      return {
        name, url, secret, activeKey, poisonedKey,
        failStreak: prev?.failStreak ?? 0,
        skipUntil: prev?.skipUntil ?? 0,
        memoVal: prev?.memoVal ?? false,
        memoUntil: prev?.memoUntil ?? 0,
      };
    };
    // Rebuilt per configure() but health/memo survive via prev-carry above
    // (getGateway re-configures on every call; without this, streaks reset).
    this.lanes = [
      mkLane('primary', (env as any)?.AGNES_PROXY_URL, (env as any)?.AGNES_PROXY_SECRET, RELAY_ACTIVE_KEY, RELAY_POISONED_KEY),
      mkLane('bak', (env as any)?.AGNES_PROXY_URL_BAK, (env as any)?.AGNES_PROXY_SECRET_BAK ?? (env as any)?.AGNES_PROXY_SECRET, RELAY_ACTIVE_KEY_BAK, RELAY_POISONED_KEY_BAK),
    ].filter((l): l is ProxyLane => l !== null);
    this.proxyAlways = String((env as any)?.AGNES_PROXY_ALWAYS ?? '').trim() === '1';
    const pTo = Number(String((env as any)?.AGNES_PROXY_TIMEOUT_MS ?? '').trim());
    if (Number.isFinite(pTo) && pTo > 0) this.proxyTimeoutMs = Math.min(pTo, 60_000);
    const models = String((env as any)?.OPENROUTER_FREE_MODELS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (models.length > 0) this.openrouterModels = [...new Set(models)];
  }

  get keyCount(): number {
    return this.pool.size;
  }

  health(): KeyHealth[] {
    return this.pool.health();
  }

  /** Lane configured for this provider? Relayable providers only (Agnes —
   *  the throttled one — plus the paid OpenRouter chat lane as the
   *  egress-blockage fallback). Sync gate: URL + secret present and off the
   *  skip-ladder. */
  private laneEnabled(lane: ProxyLane, provider: ProviderConfig): boolean {
    return (provider.id === 'agnes' || provider.id === 'openrouter-paid') && !!lane.url && !!lane.secret && Date.now() >= lane.skipUntil;
  }

  /** Lane's relay run live? Memoized 60s per isolate per lane (KV, not per call). */
  private async isLaneActive(lane: ProxyLane): Promise<boolean> {
    const now = Date.now();
    if (now < lane.memoUntil) return lane.memoVal;
    let active = false;
    try {
      active = !!(await cacheGet(lane.activeKey, RELAY_TTL_MS));
    } catch { active = false; }
    lane.memoVal = active;
    lane.memoUntil = now + RELAY_MEMO_MS;
    return active;
  }

  /** Lanes usable for this attempt, primary first. Always-on mode skips the
   *  relay gate; otherwise each lane's run must have registered itself. */
  private async usableLanes(provider: ProviderConfig): Promise<ProxyLane[]> {
    const out: ProxyLane[] = [];
    for (const lane of this.lanes) {
      if (!this.laneEnabled(lane, provider)) continue;
      if (this.proxyAlways || (await this.isLaneActive(lane))) out.push(lane);
    }
    return out;
  }

  private laneSucceeded(lane: ProxyLane): void {
    lane.failStreak = 0;
    lane.skipUntil = 0;
  }

  private laneFaulted(lane: ProxyLane): void {
    lane.failStreak++;
    if (lane.failStreak >= 3) lane.skipUntil = Date.now() + 60_000;
  }

  /** Debug: worker→proxy leg health per lane. Hostnames + runIds only — never secrets. */
  async proxyStatus(): Promise<{ ok: true; alwaysOn: boolean; lanes: Array<{ name: string; configured: boolean; host: string | null; relayActive: boolean; runId: string | null; expiresAt: number | null; skipActive: boolean; failStreak: number; reachable: boolean; ms: number; body?: string; error?: string }> }> {
    type LaneStatus = { name: string; configured: boolean; host: string | null; relayActive: boolean; runId: string | null; expiresAt: number | null; skipActive: boolean; failStreak: number; reachable: boolean; ms: number; body?: string; error?: string };
    const lanes: LaneStatus[] = [];
    for (const lane of this.lanes) {
      let host: string | null = null;
      try { host = new URL(lane.url).host; } catch { /* unset */ }
      let relayActive = false;
      let runId: string | null = null;
      let expiresAt: number | null = null;
      try {
        const flag: any = await cacheGet(lane.activeKey, RELAY_TTL_MS);
        relayActive = !!flag;
        lane.memoVal = relayActive;
        lane.memoUntil = Date.now() + RELAY_MEMO_MS;
        if (flag) {
          runId = String(flag.runId ?? '') || null;
          expiresAt = Number(flag.expiresAt ?? 0) || null;
        }
      } catch { /* ignore */ }
      const base = {
        name: lane.name, configured: !!lane.url && !!lane.secret, host, relayActive, runId, expiresAt,
        skipActive: Date.now() < lane.skipUntil, failStreak: lane.failStreak,
      };
      if (!lane.url) {
        lanes.push({ ...base, reachable: false, ms: 0, error: 'unset' });
        continue;
      }
      const start = Date.now();
      try {
        const r = await fetch(lane.url.replace(/\/+$/, '') + '/health', { signal: AbortSignal.timeout(15000) });
        const text = await r.text().catch(() => '');
        lanes.push({ ...base, reachable: r.ok, ms: Date.now() - start, body: text.slice(0, 200), ...(!r.ok ? { error: `HTTP ${r.status}` } : {}) });
      } catch (e: any) {
        lanes.push({ ...base, reachable: false, ms: Date.now() - start, error: String(e?.message ?? e).slice(0, 200) });
      }
    }
    return { ok: true as const, alwaysOn: this.proxyAlways, lanes };
  }

  /**
   * One attempt through the home proxy. Resolves with the upstream response
   * (status passed through verbatim, INCLUDING 429s — those are real key
   * signals). Rejects ONLY when the proxy/host itself is at fault (down,
   * timeout, proxy 502) so the caller falls through to direct egress
   * without touching pool health.
   */
  private async fetchViaProxy(lane: ProxyLane, path: string, body: string, headers: Record<string, string>, signal: AbortSignal | undefined, timeoutMs?: number): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(lane.url + path, {
        method: 'POST',
        headers: { ...headers, 'x-proxy-secret': lane.secret },
        body,
        signal: this.combineSignals(signal, timeoutMs ?? this.proxyTimeoutMs),
      });
    } catch (e) {
      this.laneFaulted(lane);
      const fault: any = new Error(`proxy ${lane.name} unreachable: ${e instanceof Error ? e.message : String(e)}`);
      fault.proxyFault = true;
      throw fault;
    }
    if (res.status === 502 && res.headers.get('x-proxy-error') === '1') {
      try { await res.text().catch(() => ''); } catch {}
      this.laneFaulted(lane);
      const fault: any = new Error(`proxy ${lane.name} upstream failure`);
      fault.proxyFault = true;
      throw fault;
    }
    // Dead named tunnel (no relay run alive): Cloudflare edge answers
    // 502/503/530 with an HTML "Bad Gateway / tunnel" page. That is OUR
    // lane being down, not an Agnes answer — fall through to direct WITHOUT
    // penalising the AI key (a genuine Agnes 502/503 carries a JSON body and
    // still passes through as an upstream answer below).
    if ((res.status === 502 || res.status === 503 || res.status === 530) && (await this.looksLikeTunnelDown(res))) {
      this.laneFaulted(lane);
      const fault: any = new Error(`proxy ${lane.name} tunnel down (HTTP ${res.status})`);
      fault.proxyFault = true;
      throw fault;
    }
    this.laneSucceeded(lane);
    return res;
  }

  /** Upstream answered 1015 THROUGH the relay (Azure egress itself is now
   *  throttled — genuinely new information). Flag it so cron replaces the run
   *  (new runner ≈ new IP). Best-effort; the 429 itself still flows to the
   *  caller for normal key rotation. Reads a clone; original stays consumable. */
  private async flagRelayPoisoned(lane: ProxyLane, res: Response): Promise<void> {
    try {
      if (res.status === 429 && (await this.isIpThrottle(res))) {
        await cacheSet(lane.poisonedKey, { at: Date.now(), lane: lane.name }, RELAY_POISONED_TTL_MS);
        logger.warn?.(`[AiGateway] 1015 arrived via relay lane ${lane.name} — flagging run poisoned`);
      }
    } catch { /* best-effort */ }
  }

  /** True when a proxy-leg 5xx looks like a dead-tunnel edge page (HTML /
   *  Bad Gateway / tunnel / 1033 markers) rather than an Agnes JSON answer.
   *  Reads a clone so the original response stays consumable. */
  private async looksLikeTunnelDown(res: Response): Promise<boolean> {
    try {
      const ct = res.headers.get('content-type') || '';
      const head = (await res.clone().text()).slice(0, 500);
      return /text\/html/.test(ct) || /cloudflare|bad gateway|tunnel|1033|error code/i.test(head);
    } catch {
      return false;
    }
  }

  /** True when a 429 body carries Cloudflare's 1015 edge-throttle signature
   *  (IP-level block, not per-key quota). Reads a clone so the original
   *  response stays consumable. */
  private async isIpThrottle(res: Response): Promise<boolean> {
    try {
      const text = await res.clone().text();
      return /1015|error code:\s*1015/i.test(text);
    } catch {
      return false;
    }
  }

  private gatewayBaseURL(provider: ProviderConfig): string {
    if (this.aigAccount && this.aigGateway) {
      // Standardized Cloudflare AI Gateway reverse proxy (custom providers use custom-{slug})
      if (provider.id === 'agnes') return `https://gateway.ai.cloudflare.com/v1/${this.aigAccount}/${this.aigGateway}/custom-agnes/v1/chat/completions`;
      if (provider.id === 'openrouter' || provider.id === 'openrouter-paid') return `https://gateway.ai.cloudflare.com/v1/${this.aigAccount}/${this.aigGateway}/custom-openrouter/api/v1/chat/completions`;
      if (provider.id === 'groq') return `https://gateway.ai.cloudflare.com/v1/${this.aigAccount}/${this.aigGateway}/groq/chat/completions`;
      if (provider.id === 'requestly') return provider.baseURL; // not via gateway
    }
    return provider.baseURL;
  }

  /**
   * Core completion call. Picks a key, calls the provider, rotates + retries on
   * transient/provider errors (bounded by maxAttempts — one fresh key per
   * attempt, so N keys ≈ N chances). Plain Agnes 429s cool that key and rotate
   * to the next; Cloudflare 1015 fails fast (egress-IP based — rotating keys
   * can't help). Sticky `sessionKey` requests stay pinned while healthy.
   * Throws AiGatewayError only when every attempt is exhausted.
   *
   * Cloudflare AI Gateway note: rotation only swaps the `Authorization: Bearer`
   * header value. URLs (incl. `custom-*` gateway paths), bodies, and models are
   * untouched, so CF-side caching / logging / rate-limiting see zero change —
   * and CF cache keys (method+URL+body) are unaffected by Bearer rotation.
   */
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    // Auto-route Agnes models to Agnes provider when no explicit provider is set.
    if (!req.provider && req.model && req.model.startsWith('agnes-')) {
      req = { ...req, provider: 'agnes' };
    }
    // Standardized app-wide: KV response cache (5m) + single-flight + fail-fast 429.
    // Caches identical prompts (enquiry extraction re-tries, duplicate saves) to cut RPM without extra keys.
    const cacheable = !req.signal?.aborted && (req.json || false) && !req.tools?.length;
    // Only cache deterministic JSON extractions (enrichment/vision) — chat (tools/stream) bypasses.
    let aiCacheKey: string | null = null;
    if (cacheable) {
      try {
        const prov = req.provider || (req.model?.startsWith('agnes-') ? 'agnes' : 'agnes');
        const model = req.model || PROVIDERS[prov]?.defaultModel || 'agnes-3.0-flash';
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
    if (activeModel && FALLBACK_MODEL[activeModel] && (await modelFlagged(activeModel))) {
      logger.warn?.(`[AiGateway] ${activeModel} flagged down — starting on ${FALLBACK_MODEL[activeModel]}`);
      activeModel = FALLBACK_MODEL[activeModel];
      fellBack = true;
    }
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const key = req.keyId
        ? this.findKey(req.keyId) ?? this.pool.select(req.provider, req.sessionKey, req.strictProvider === true)
        : this.pool.select(req.provider, req.sessionKey, req.strictProvider === true);
      if (!key) {
        const waitMs = this.pool.earliestCooldownMs();
        const retryAfter = waitMs > 0 ? Math.min(waitMs, 60_000) : 60_000;
        // Strict pin: name the starved provider so the caller's chain fails
        // over to its next leg explicitly (vision-intake treats 429 as
        // try-next-provider). Message carries "Rate-limited" for isRateLimited.
        const e: any = req.provider && req.strictProvider
          ? new Error(`HTTP 429: Rate-limited (no healthy ${req.provider} key — pinned, not falling back; retry after ${Math.round(retryAfter/1000)}s)`)
          : new Error(`HTTP 429: Rate-limited (retry after ${Math.round(retryAfter/1000)}s)`);
        e.status = 429; e.retryAfter = retryAfter;
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
        return result;
      } catch (err) {
        lastErr = err;
        // Relay-only fast-fail (no lane warm): NOT a key failure — the key is
        // innocent, the lane is just down. Skip pool penalty AND remaining
        // key attempts; the caller's provider chain (vision-intake) falls
        // through to OpenRouter immediately.
        if ((err as any)?.skipProvider) throw err;
        // Hung model channel (timeout, no HTTP status — proxy faults and
        // caller cancels excluded): record the outage, switch to the
        // fallback model, retry immediately. Keys are never rotated for a
        // hang — every key would hang identically on a dead channel.
        const timedOut = (err as any)?.name === 'TimeoutError' || /timeout/i.test(String((err as any)?.message ?? ''));
        const abortHang = !(err as any)?.proxyFault && timedOut;
        if (abortHang && req.model && FALLBACK_MODEL[req.model] && !fellBack) {
          fellBack = true;
          await flagModelDown(req.model);
          logger.warn?.(`[AiGateway] ${req.model} hung — failing over to ${FALLBACK_MODEL[req.model]}`);
          activeModel = FALLBACK_MODEL[req.model];
          continue;
        }
        const status = this.pool.extractStatus(err);
        if (status === 429) {
          if (provider.id === 'agnes') {
            const msg = String((err as any)?.message ?? '');
            const isCf1015 = /1015|error code: 1015/i.test(msg);
            const retryAfter = this.extractRetryAfter(err);
            if (isCf1015) {
              // IP-level throttle, NOT key quota: cool briefly and ROTATE —
              // the next key's direct call may land outside the throttle
              // window, and every attempt also gets its proxy shot inside
              // callProvider. Only the final attempt throws, preserving
              // chat's busy-signal when truly everything is throttled.
              const rawCd = retryAfter ?? 72_000;
              const cd = Math.min(rawCd, 60_000);
              key.cooldownUntil = Date.now() + cd;
              key.failures++;
              key.lastFailureAt = Date.now();
              key.lastError = `429 Cloudflare 1015`;
              logger.warn?.(`[AiGateway] 429 Cloudflare 1015 on ${key.id} — cooling ${Math.round(cd/1000)}s (raw ${Math.round(rawCd/1000)}s), rotating to next key (attempt ${attempt + 1}/${maxAttempts})`);
              if (attempt >= maxAttempts - 1) {
                const e: any = new Error(`HTTP 429: Rate-limited (Cloudflare 1015, retry after ${Math.round(cd/1000)}s)`);
                e.status = 429; e.retryAfter = cd; throw e;
              }
              continue;
            }
            // Plain Agnes 429 is per-key quota: cool THIS key and rotate to
            // the next one in the pool (bounded by maxAttempts). The next
            // select() skips the cooling key, so a sticky sessionKey
            // transparently fails over mid-conversation only when it must.
            // Cooldown escalates while the key keeps failing (60s → 120s →
            // 240s → 480s, capped 10 min) so chronic-429 keys stop burning
            // seconds on every rejoin; one success resets the ladder.
            const rawCd = retryAfter ?? 60_000;
            key.failures++;
            key.lastFailureAt = Date.now();
            const cd = Math.min(rawCd, 60_000 * Math.pow(2, Math.min(key.failures - 1, 3)), 600_000);
            key.cooldownUntil = Date.now() + cd;
            key.lastError = `429 rate-limited`;
            logger.warn?.(`[AiGateway] 429 on ${key.id} (agnes) — cooling ${Math.round(cd/1000)}s, rotating to next key (attempt ${attempt + 1}/${maxAttempts})`);
            continue;
          }
          // Burst 429s (RPM limits) on a sticky-pinned key: retrying the SAME
          // key burns all attempts while sibling keys sit idle ("exhausted
          // after 5"). Brief cooldown forces select() to fail the pin over to
          // the next healthy key; short enough (≤60s) to rejoin fast.
          streak429++;
          if (
            !req.model && !wantsVision && provider.id === 'openrouter' &&
            this.openrouterModels.length > 1 && streak429 % ROTATE_EVERY === 0
          ) {
            this.modelIdx = (this.modelIdx + 1) % this.openrouterModels.length;
            rotatedModel = this.openrouterModels[this.modelIdx];
            logger.warn?.(`[AiGateway] 429 streak x${streak429} — rotating OpenRouter model to ${rotatedModel}`);
          }
          const retryAfter = this.extractRetryAfter(err);
          key.failures++;
          key.lastFailureAt = Date.now();
          key.cooldownUntil = Date.now() + Math.min(retryAfter ?? 15_000, 60_000);
          key.lastError = `429 retry ${attempt + 1}/${maxAttempts}${rotatedModel ? ` (${rotatedModel})` : ''} — rotated to next key`;
          // Standardized backoff: 0.8s, 1.6s, 3.2s cap 5s — max 3 attempts total, then fail fast.
          if (attempt < maxAttempts - 1) {
            const backoff = Math.min(retryAfter ?? 800 * Math.pow(2, attempt), 5_000);
            logger.warn?.(`[AiGateway] 429 on ${key.id}, retry ${attempt + 1}/${maxAttempts} after ${backoff}ms`);
            await sleep(backoff);
            continue;
          }
          const e2: any = new Error(`HTTP 429: Rate-limited (retry after ${Math.round((retryAfter ?? 60_000)/1000)}s)`);
          e2.status = 429; e2.retryAfter = retryAfter ?? 60_000;
          throw e2;
        }
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
    if (!req.provider && req.model && req.model.startsWith('agnes-')) {
      req = { ...req, provider: 'agnes' };
    }
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
    const key = req.keyId ? this.findKey(req.keyId) ?? this.pool.select(req.provider, req.sessionKey, req.strictProvider === true) : this.pool.select(req.provider, req.sessionKey, req.strictProvider === true);
    if (!key) throw new AiGatewayError('No AI key available (pool empty or all disabled)');
    const provider = PROVIDERS[key.provider] ?? PROVIDERS.groq;
    const wantsVision = req.messages.some((m) => Array.isArray(m.content));
    const model = req.model || (wantsVision ? this.visionModelOverride || provider.visionModel || provider.defaultModel : provider.defaultModel);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${key.key}`, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
    const body: Record<string, unknown> = {
      model, messages: req.messages, temperature: req.temperature ?? 0.2,
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(Array.isArray(req.tools) && req.tools.length > 0 ? { tools: req.tools } : {}),
      ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
      ...provider.extraParams, ...(req.extraParams ?? {}), stream: true,
    };
    if (req.json && provider.jsonMode) body.response_format = provider.jsonMode;
    if (provider.id === 'agnes' && req.reasoningEffort && !req.reasoningOff) (body as any).chat_template_kwargs = { enable_thinking: true };
    else if (provider.reasoningObject && !req.reasoningOff) (body as any).reasoning = { enabled: true };
    else if (provider.supportsReasoning && req.reasoningEffort && !req.reasoningOff) (body as any).reasoning_effort = req.reasoningEffort;
    const url = this.gatewayBaseURL(provider);
    const payload = JSON.stringify(body);
    // Direct-first for streams: try Cloudflare egress first, relay only on
    // 1015 or direct throw. Hot-standby lanes tried primary→bak per attempt.
    const tryProxy = async (): Promise<Response | null> => {
      const lanes = await this.usableLanes(provider);
      if (lanes.length === 0) return null;
      const path = new URL(provider.baseURL).pathname;
      for (const lane of lanes) {
        try {
          const pres = await this.fetchViaProxy(lane, path, payload, headers, req.signal, streamCap);
          if (pres.status === 403) {
            this.laneFaulted(lane);
            logger.warn?.(`[AiGateway] relay lane ${lane.name} 403 (secret?) — trying next lane`);
            continue;
          }
          if (pres.status === 429) await this.flagRelayPoisoned(lane, pres);
          return pres;
        } catch (e) {
          logger.warn?.(`[AiGateway] relay lane ${lane.name} failed (${(e as Error)?.message ?? e}) — trying next lane`);
        }
      }
      return null;
    };
    let res: Response | null = null;
    try {
      if (provider.id === 'agnes' && (req as any)?.agnesRelayOnly) {
        // Relay-only streams (chat Agnes leg): direct Cloudflare egress is
        // WAF-blocked, so lanes-only — fail fast when no lane is warm and
        // let the caller's leg chain fall through to paid.
        const proxied = await tryProxy();
        if (!proxied) {
          const e: any = new Error('Agnes relay lane unavailable — direct skipped (relayOnly)');
          e.skipProvider = true;
          throw e;
        }
        res = proxied;
      } else {
        res = await fetch(url, { method: 'POST', headers, body: payload, signal: this.combineSignals(req.signal, streamCap) });
        if (res.status === 429 && (await this.isIpThrottle(res))) {
          const proxied = await tryProxy();
          if (proxied) res = proxied;
        }
      }
    } catch (e) {
      const timedOut = (e as any)?.name === 'TimeoutError' || /timeout/i.test(String((e as any)?.message ?? ''));
      const abortHang = !(e as any)?.proxyFault && timedOut;
      if (abortHang && req.model && FALLBACK_MODEL[req.model]) {
        await flagModelDown(req.model);
        throw new Error(`AI model ${req.model} timed out (fallback to ${FALLBACK_MODEL[req.model]} engaged) — retry the call`);
      }
      const proxied = await tryProxy();
      if (proxied) res = proxied;
      else throw e;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err: any = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status; err.retryAfter = this.parseRetryAfter(res.headers);
      // Feed pool health so the next turn rotates away from a 429'd key.
      try { this.pool.reportFailure(key, err, err.retryAfter); } catch {}
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
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    this.pool.reportSuccess(key);
    // Same audit for streams (chat serves streamed turns — without this,
    // streamed legs are invisible in the tail).
    logger.info?.(`[AiGateway] stream served by ${key.id} (${provider.id}/${model})`);
    if (lastUsage) await logGatewayUsage(lastUsage);
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
      // Agnes WAF blocks bare Workers/undici UAs — browser-like UA bypasses 1020/1015 bot check
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(Array.isArray(req.tools) && req.tools.length > 0 ? { tools: req.tools } : {}),
      ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
      ...provider.extraParams,
      ...(req.extraParams ?? {}),
    };
    if (req.json && provider.jsonMode) {
      body.response_format = provider.jsonMode;
    }
    if (provider.id === 'agnes' && req.reasoningEffort && !req.reasoningOff) {
      // Agnes uses chat_template_kwargs.enable_thinking for reasoning depth (OpenAI-compatible).
      // Verified 2026-09-20: agnes-2.5-flash streams reasoning_content with this flag.
      (body as any).chat_template_kwargs = { enable_thinking: true };
    } else if (provider.reasoningObject && !req.reasoningOff) {
      // OpenRouter-style reasoning switch (ling models etc.).
      body.reasoning = { enabled: true };
    } else if (provider.supportsReasoning && req.reasoningEffort && !req.reasoningOff) {
      body.reasoning_effort = req.reasoningEffort;
    }
    const payload = JSON.stringify(body);
    // Proxy-first (home egress): the fastest/cleanest lane goes first by
    // default; direct Cloudflare egress is the fallback when the proxy is
    // down, slow, or unconfigured. A proxy 429 is a REAL upstream answer
    // (same key/account quota) and is returned as the attempt result — only
    // proxy FAULTS (unreachable/timeout/502) and our own 403s (secret
    // mismatch, never a provider signal) fall through to direct.
    const url = this.gatewayBaseURL(provider);
    const proxyPath = new URL(provider.baseURL).pathname;
    const tryProxy = async (): Promise<Response | null> => {
      const lanes = await this.usableLanes(provider);
      if (lanes.length === 0) return null;
      for (const lane of lanes) {
        try {
          const pres = await this.fetchViaProxy(lane, proxyPath, payload, headers, req.signal, req.timeoutMs);
          if (pres.status === 403) {
            this.laneFaulted(lane);
            logger.warn?.(`[AiGateway] relay lane ${lane.name} 403 (secret?) — trying next lane`);
            continue;
          }
          if (pres.status === 429) await this.flagRelayPoisoned(lane, pres);
          return pres;
        } catch (e) {
          logger.warn?.(`[AiGateway] relay lane ${lane.name} failed (${(e as Error)?.message ?? e}) — trying next lane`);
        }
      }
      return null;
    };
    // Direct-first: try Cloudflare egress first (fast path 0.6s), relay only
    // on 1015 IP-throttle or direct fetch throw. Saves ~1s tunnel tax when WAF quiet.
    // Relay-only callers (agnesRelayOnly — intake): direct Agnes egress is
    // ~100% 1015-throttled, so skip it entirely — lanes if warm, else fail
    // fast and let the caller's provider chain fall through to OpenRouter.
    let res: Response | null = null;
    let directThrew: unknown = null;
    if (provider.id === 'agnes' && (req as any)?.agnesRelayOnly) {
      const proxied = await tryProxy();
      if (!proxied) {
        const e: any = new Error('Agnes relay lane unavailable — direct skipped (relayOnly)');
        e.skipProvider = true;
        throw e;
      }
      res = proxied;
    } else
    try {
      res = await fetch(url, { method: 'POST', headers, body: payload, signal: this.combineSignals(req.signal, req.timeoutMs) });
      if (res.status === 429 && (await this.isIpThrottle(res))) {
        const proxied = await tryProxy();
        if (proxied) res = proxied;
      }
    } catch (e) {
      directThrew = e;
      const proxied = await tryProxy();
      if (proxied) res = proxied;
      else throw directThrew;
    }
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
