// Extracted verbatim from ai-gateway.ts by scripts/refactor/split-module.mjs.
// ai-gateway.ts re-exports everything public here, so existing imports keep working.


// ── Provider registry ────────────────────────────────────────────────────────
export interface ProviderConfig {
  id: string;
  baseURL: string;
  extraParams?: Record<string, unknown>;
  supportsReasoning: boolean;
  /** OpenRouter-style reasoning switch (`reasoning: { enabled: true }`). */
  reasoningObject?: boolean;
  jsonMode?: { type: 'json_object' };
  defaultModel: string;
  /** Used when a request carries image parts and no explicit model is set. */
  visionModel?: string;
}

// ── Key identity + health ────────────────────────────────────────────────────
export interface AiKey {
  id: string;
  provider: string;
  key: string;
  label: string;
  enabled: boolean;
  failures: number;
  cooldownUntil: number;
  lastError: string | null;
  lastFailureAt: number;
  lastUsedAt: number;
  successCount: number;
}

export type KeyHealth = Pick<
  AiKey,
  'id' | 'label' | 'provider' | 'enabled' | 'failures' | 'cooldownUntil' | 'lastError' | 'lastUsedAt' | 'successCount'
>;

// ── Request / response ───────────────────────────────────────────────────────
export interface TextPart { type: 'text'; text: string }

export interface ImagePart { type: 'image_url'; image_url: { url: string } }

export type MessageContent = string | Array<TextPart | ImagePart>;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent;
  /** Tool-result linkage (agentic loops). Passed through verbatim. */
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  /** Assistant deliberation echo (reasoning models): passed through verbatim
   *  so tool chains continue mid-thought instead of re-deriving. */
  reasoning?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  provider?: string;
  keyId?: string;
  /**
   * Conversation affinity (e.g. `enquiry:chat:<id>:<user>`). When set, the
   * gateway pins this request stream to ONE key via consistent hashing, so
   * provider-side prefix-cache / Cloudflare AI Gateway cache affinity is
   * preserved across turns — keys are NOT rotated mid-conversation while the
   * pinned key stays healthy. On 429/5xx the pinned key cools and the ring
   * probe transparently fails over to the next key. Omit for one-shot calls
   * (extraction, runners): those spread randomly across the healthiest tier.
   * Generic — works for every current and future provider in PROVIDERS.
   */
  sessionKey?: string;
  /** Optional per-attempt wall-clock cap (ms). Hung attempts abort fast so
   *  rotation moves on; callers with a UI budget (copilot) set this, batch
   *  runners leave it unset (current unbounded behavior). */
  timeoutMs?: number;
  /** Probe cap for the pre-fallback primary model only (ms). Lets callers
   *  sample an advanced-but-flaky model cheaply: the FIRST attempt(s) on the
   *  requested model abort fast, while post-fallback attempts use timeoutMs.
   *  E.g. { model: 'agnes-3.0-flash', probeTimeoutMs: 8000, timeoutMs: 20000 }
   *  tests 3.0 for 8s, then serves from 2.5 with a 20s budget. */
  probeTimeoutMs?: number;
  json?: boolean;
   model?: string;
   reasoningEffort?: 'low' | 'medium' | 'high';
   /** Suppress chain-of-thought (no `reasoning` param sent): for
    *  classification/extraction calls where thinking tokens are pure billed
    *  overhead with zero UI use. Chat leaves this unset (thinking dropdown). */
   reasoningOff?: boolean;
   /** Per-request provider body params, merged over provider.extraParams
    *  (e.g. OpenRouter `{ provider: { only: [...], allow_fallbacks: true } }`
    *  routing for the paid chat lane). */
   extraParams?: Record<string, unknown>;
   signal?: AbortSignal;
  /** OpenAI-style function tools (passed through verbatim). */
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /** Agnes relay-only (intake): use the existing GH-runner relay lane when
   *  warm, but NEVER attempt direct Cloudflare egress for Agnes — it is
   *  1015-throttled to ~100% failure (5 aborts × 20s per call). With no lane
   *  up, fail fast so the caller's provider chain falls through to OpenRouter
   *  instead of burning two minutes on doomed direct attempts. No new infra —
   *  this only gates the already-built lane vs direct choice per request. */
  agnesRelayOnly?: boolean;
  /** Strict provider pin: when set with `provider`, key selection returns
   *  null unless a HEALTHY key of that exact provider exists — never a random
   *  cross-provider fallback. Intake sets this so paid-lane exhaustion fails
   *  over to the next chain leg explicitly instead of serving a weak model
   *  disguised as the pinned provider. Default (unset) keeps the loose
   *  degrade-through-pool contract chat/copilot rely on. */
  strictProvider?: boolean;
}

export interface CompletionResult {
  content: string;
  provider: string;
  keyId: string;
  model: string;
  jsonParsed: boolean;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  toolCalls?: ToolCall[];
  /** Assistant reasoning text (OpenRouter `message.reasoning`), when present. */
  reasoning?: string;
  /** Provider stop reason (`choices[0].finish_reason`) — lets callers tell
   *  "model chose silence" apart from "cut off by max_tokens" (length). */
  finishReason?: string;
}

/** One egress lane: its own tunnel URL, secret, KV lifecycle flag, and
 *  health state. Primary + backup run as independent GH runs so a poisoned
 *  lane is replaceable without touching the other. */
export interface ProxyLane {
  name: string;
  url: string;
  secret: string;
  activeKey: string;
  poisonedKey: string;
  failStreak: number;
  skipUntil: number;
  memoVal: boolean;
  memoUntil: number;
}
