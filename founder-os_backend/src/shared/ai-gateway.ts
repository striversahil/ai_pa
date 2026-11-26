/**
 * Unified multi-provider AI gateway — the SINGLE module every AI call in the
 * system routes through. One chain (Setting `ai:providers` order), one global
 * strategy (`ai:strategy`: least-used-first | round-robin), direct
 * OpenAI-compatible egress. Every key in the pool is provider-tagged; the
 * gateway handles strategy selection, 429 cooldown (honors retry-after),
 * 401/403 disable, 5xx rotate, immediate failover on timeout.
 *
 * Key configuration (founder decision 2026-11-27 — Settings ONLY):
 *   Setting ai:providers = {"providers":[{"id,baseUrl,model,keys":[...]}]}
 *     (root-managed in Settings → AI gateway; OpenAI-compatible endpoints)
 *   env.AI_KEYS / OPENROUTER_* / REQUESTLY_* / GROQ_* = IGNORED.
 *   There is no built-in provider/default: an empty Setting = an empty pool.
 *   GH Actions never read env keys either — runners call POST /api/ai/complete.
 *
 * Runtime note: edge-safe (no Node-only deps) so it bundles into the
 * Worker via build-worker.mjs.
 */
import { AiGateway } from "./ai-gateway-parts/io";

// Pieces split into ./ai-gateway-parts/ (importable on their own); re-exported for compat.
export { gatewayUsageKey, PROVIDERS, AiGatewayError, KeyPool, keyFingerprintId, extractJson, buildVisionUserContent } from "./ai-gateway-parts/pure";
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
