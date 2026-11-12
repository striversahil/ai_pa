/**
 * Unified multi-provider AI gateway — the SINGLE module every AI call in the
 * system routes through. **Dashboard chat copilots are primary on the paid
 * OpenRouter lane** (`openrouter-paid`: deepseek/deepseek-v4.1-flash,
 * streamlake/fp8 preferred) — direct Cloudflare egress first, GH relay lanes
 * only on 1015/blockage. Agnes stays pooled for runners; Dahl and Groq
 * remain as fallbacks. Every key in the pool is provider-tagged;
 * the gateway handles least-failures selection, 429 cooldown (honors
 * retry-after), 401/403 disable, 5xx rotate. Primary model agnes-3.0-flash
 * (2.5-flash is the automatic fallback if the 3.0 channel hangs).
 *
 * Key configuration (single source of truth, both runtimes):
 *   env.AI_KEYS         = "provider:key:label,..."  (e.g. "agnes:sk-...:primary, groq:gsk_...:fallback")
 *   env.AGNES_API_KEY   = single Agnes key (sk-...)
 *   env.AGNES_API_KEYS  = comma-separated Agnes keys
 *   env.GROQ_API_KEYS   = IGNORED (founder decision 2026-09-21: hallucination quality)
 *   env.OMNIROUTE_*     = IGNORED
 * Egress-relay proxy (optional, Agnes only — see agnes-relay*.yml):
 *   env.AGNES_PROXY_URL = STATIC named-tunnel hostname of the GH relay (unset = direct egress)
 *   env.AGNES_PROXY_SECRET = shared secret the proxy requires per call
 *   env.AGNES_PROXY_URL_BAK / _SECRET_BAK = hot-standby second lane (agnes-relay-bak)
 *     — per-attempt failover primary→bak in seconds; per-lane poison replace.
 *   env.AGNES_PROXY_TIMEOUT_MS = proxy attempt cap, default 25000 (max 60000)
 *   NOTE: home-egress/ (old home PC tunnel) is DISCARDED 2026-09-22 — AGNES_PROXY_ALWAYS
 *   is ignored; lanes are on-demand GH relays only (KV ai:relay:active[:bak]).
 *
 * Agnes uses `chat_template_kwargs: {enable_thinking:true}` for reasoning
 * (mapped from `reasoningEffort`), base https://apihub.agnes-ai.com/v1.
 * Dahl/OpenRouter legacy: keep keys in pool but not primary.
 *
 * Runtime note: edge-safe (no Node-only deps) so it bundles into the
 * Worker via build-worker.mjs. GH Actions consume JS port scripts/ai-gateway.js
 * that mirrors this surface. Both read same AI_KEYS contract.
 */
import { AiGateway } from "./ai-gateway-parts/io";

// Pieces split into ./ai-gateway-parts/ (importable on their own); re-exported for compat.
export { gatewayUsageKey, PAID_CHAT_ROUTING, PROVIDERS, AiGatewayError, KeyPool, RELAY_ACTIVE_KEY, RELAY_TTL_MS, RELAY_COOLDOWN_KEY, RELAY_COOLDOWN_MS, RELAY_POISONED_KEY, RELAY_POISONED_TTL_MS, RELAY_ACTIVE_KEY_BAK, RELAY_POISONED_KEY_BAK, extractJson, buildVisionUserContent } from "./ai-gateway-parts/pure";
export { logGatewayUsage, readGatewayUsage, AiGateway } from "./ai-gateway-parts/io";
export type { ProviderConfig, AiKey, KeyHealth, TextPart, ImagePart, MessageContent, ChatMessage, ToolDefinition, ToolCall, CompletionRequest, CompletionResult, ProxyLane } from "./ai-gateway-parts/types";

// ── Singleton ────────────────────────────────────────────────────────────────
let _gateway: AiGateway | null = null;

export function getGateway(env?: Record<string, unknown>): AiGateway {
  if (!_gateway) {
    _gateway = new AiGateway(env);
  } else if (env) {
    _gateway.configure(env);
  }
  return _gateway;
}
