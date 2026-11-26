// ai-gateway/types.ts — shared shapes for the Settings AI gateway panel.
// mirror: founder-os_backend/src/worker/ai-gateway-health.ts (redacted shape)
//         + src/shared/ai-gateway-parts/health.ts (score bands)

export interface AiKeyHealth {
  score: number;
  samples: number;
  reliability?: number;
  speed?: number;
  throughput?: number;
  atRisk?: boolean;
  lastErrorKind?: string;
  evaluatedAt?: string;
}

export interface AiKeyInfo {
  id: string;
  label: string;
  last4: string;
  enabled: boolean;
  disabledBy: "user" | "health" | null;
  disabledReason: string | null;
  healthResetAt: string | null;
  health: AiKeyHealth | null;
}

export interface AiProviderInfo {
  id: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  keys: AiKeyInfo[];
}

export interface AiHealthConfig {
  threshold: number;
  atRisk: number;
  minSamples: number;
  tpsTarget: number;
  ttftGoodMs: number;
  ttftBadMs: number;
  autoDisable: boolean;
}

/** Runtime provider row (in-memory pool, this isolate). */
export interface AiRuntimeProvider {
  provider: string;
  usable: number;
  total: number;
}

export interface AiGatewayPayload {
  ok: boolean;
  strategy: string;
  keys: number;
  providers: AiRuntimeProvider[];
  config?: {
    providers: AiProviderInfo[];
    health: AiHealthConfig;
  };
}

export interface ProbeMetrics {
  latencyMs: number;
  ttftMs: number | null;
  completionTokens: number;
  totalTokens: number;
  tps: number | null;
}

export interface ProbeResult {
  content: string;
  metrics: ProbeMetrics;
}

export interface KeyCallRow {
  keyId: string;
  provider: string;
  ok: boolean;
  status: number | null;
  errorKind: string | null;
  latencyMs: number;
  ttftMs: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  streamed: boolean;
  source: string;
  createdAt: string;
}
