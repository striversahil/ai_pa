/**
 * Unified multi-provider AI gateway — the SINGLE module every AI call in the
 * system routes through. One chain (Setting `ai:providers` order, env keys
 * appended), one global strategy (`ai:strategy`: least-used-first |
 * round-robin), direct OpenAI-compatible egress. Every key in the pool is
 * provider-tagged; the gateway handles strategy selection, 429 cooldown
 * (honors retry-after), 401/403 disable, 5xx rotate.
 *
 * Key configuration (single source of truth, both runtimes):
 *   Setting ai:providers = {"providers":[{"id,baseUrl,model,keys":[...]}]}
 *     (root-managed in Settings → AI gateway; OpenAI-compatible endpoints)
 *   env.AI_KEYS         = "provider:key:label,..."  (fallback pool)
 *   env.AGNES_API_KEY(S) / OPENROUTER_* / REQUESTLY_* = legacy env keys
 *   env.GROQ_API_KEYS   = IGNORED (founder decision 2026-09-21: hallucination quality)
 *
 * Runtime note: edge-safe (no Node-only deps) so it bundles into the
 * Worker via build-worker.mjs. GH Actions consume JS port scripts/ai-gateway.js
 * that mirrors this surface. Both read same AI_KEYS contract.
 */
import { AiGateway } from "./ai-gateway-parts/io";

// Pieces split into ./ai-gateway-parts/ (importable on their own); re-exported for compat.
export { gatewayUsageKey, PAID_CHAT_ROUTING, PROVIDERS, AiGatewayError, KeyPool, keyFingerprintId, extractJson, buildVisionUserContent } from "./ai-gateway-parts/pure";
export { setGatewayMetricSink, emitGatewayMetric, classifyGatewayError, GATEWAY_ERROR_WEIGHTS, FATAL_ERROR_KINDS } from "./ai-gateway-parts/metrics";
export { DEFAULT_AI_HEALTH, parseAiHealthConfig, scoreKeyHealth } from "./ai-gateway-parts/health";
export type { GatewayCallMetric, GatewayErrorKind } from "./ai-gateway-parts/metrics";
export type { AiHealthConfig, HealthSample, KeyHealthScore } from "./ai-gateway-parts/health";
export { logGatewayUsage, readGatewayUsage, AiGateway } from "./ai-gateway-parts/io";
export type { ProviderConfig, AiKey, KeyHealth, TextPart, ImagePart, MessageContent, ChatMessage, ToolDefinition, ToolCall, CompletionRequest, CompletionResult } from "./ai-gateway-parts/types";

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
