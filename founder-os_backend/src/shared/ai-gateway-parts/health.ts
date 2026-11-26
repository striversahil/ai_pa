// ai-gateway-parts/health.ts — pure health score for one AI key.
//
// score = 0.5·reliability + 0.3·speed + 0.2·throughput   (0–100)
//   reliability : 100 × (1 − Σ errorWeight / samples)
//   speed       : streamed TTFT mapped 100 at ≤ttftGoodMs, 0 at ≥ttftBadMs
//   throughput  : tokens/sec mapped 100 at ≥tpsTarget
// A key below `threshold` with at least `minSamples` calls is auto-disabled
// (unless autoDisable is off). `atRisk` is the earlier warning band.
//
// Dual-runtime + sync-only: the Worker sweep and the guards both score with
// this single function; no D1, no fetch.
import { GATEWAY_ERROR_WEIGHTS, type GatewayErrorKind } from "./metrics";

export interface AiHealthConfig {
  /** Auto-disable below this score (with enough samples). */
  threshold: number;
  /** Amber "verge of disabling" band. Must be > threshold. */
  atRisk: number;
  /** Minimum non-playground calls before an auto-disable decision. */
  minSamples: number;
  /** Tokens/sec that earns a full throughput score. */
  tpsTarget: number;
  /** TTFT at/below this is a perfect speed score. */
  ttftGoodMs: number;
  /** TTFT at/above this is a zero speed score. */
  ttftBadMs: number;
  /** Observe-only escape hatch: score + flag, never flip a key off. */
  autoDisable: boolean;
}

export const DEFAULT_AI_HEALTH: AiHealthConfig = {
  threshold: 40,
  atRisk: 60,
  minSamples: 5,
  tpsTarget: 40,
  ttftGoodMs: 800,
  ttftBadMs: 5000,
  autoDisable: true,
};

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Parse Setting `ai:health` (JSON). Bad JSON / bad fields fall back to the
 *  documented defaults — health tuning can never break the sweep. */
export function parseAiHealthConfig(raw: unknown): AiHealthConfig {
  let parsed: any = null;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  } else if (raw && typeof raw === "object") parsed = raw;
  const d = DEFAULT_AI_HEALTH;
  if (!parsed || typeof parsed !== "object") return { ...d };
  const threshold = num(parsed.threshold, d.threshold, 1, 99);
  const atRisk = Math.max(threshold + 1, num(parsed.atRisk, d.atRisk, 2, 100));
  return {
    threshold,
    atRisk,
    minSamples: Math.round(num(parsed.minSamples, d.minSamples, 1, 200)),
    tpsTarget: num(parsed.tpsTarget, d.tpsTarget, 1, 500),
    ttftGoodMs: num(parsed.ttftGoodMs, d.ttftGoodMs, 50, 30000),
    ttftBadMs: Math.max(num(parsed.ttftGoodMs, d.ttftGoodMs, 50, 30000) + 100, num(parsed.ttftBadMs, d.ttftBadMs, 100, 60000)),
    autoDisable: parsed.autoDisable === false ? false : true,
  };
}

export interface HealthSample {
  ok: boolean;
  errorKind?: GatewayErrorKind | string | null;
  ttftMs?: number | null;
  totalMs: number;
  completionTokens?: number | null;
  totalTokens?: number | null;
  streamed?: boolean;
}

export type HealthStatus = "healthy" | "at_risk" | "critical";

export interface KeyHealthScore {
  score: number;
  reliability: number;
  speed: number;
  throughput: number;
  /** Calls considered (playground already filtered out). */
  samples: number;
  errorRate: number;
  avgTtftMs: number | null;
  avgTps: number | null;
  atRisk: boolean;
  critical: boolean;
  status: HealthStatus;
}

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function scoreKeyHealth(samples: HealthSample[], cfg: AiHealthConfig = DEFAULT_AI_HEALTH): KeyHealthScore {
  const list = Array.isArray(samples) ? samples : [];
  const n = list.length;
  if (n === 0) {
    return {
      score: 100, reliability: 100, speed: 70, throughput: 70, samples: 0,
      errorRate: 0, avgTtftMs: null, avgTps: null,
      atRisk: false, critical: false, status: "healthy",
    };
  }
  let weightedFailures = 0;
  let failures = 0;
  const ttfts: number[] = [];
  const tpsList: number[] = [];
  for (const s of list) {
    if (!s.ok) {
      failures++;
      const kind = String(s.errorKind ?? "unknown") as GatewayErrorKind;
      weightedFailures += GATEWAY_ERROR_WEIGHTS[kind] ?? GATEWAY_ERROR_WEIGHTS.unknown;
    }
    const ttft = Number(s.ttftMs ?? 0);
    if (s.streamed && ttft > 0) ttfts.push(ttft);
    const ms = Number(s.totalMs ?? 0);
    const tokens = Number(s.completionTokens ?? 0);
    if (ms > 0 && tokens > 0) tpsList.push(tokens / (ms / 1000));
  }
  const reliability = clamp100(100 * (1 - weightedFailures / n));
  const avgTtftMs = ttfts.length > 0 ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : null;
  const speed = avgTtftMs == null
    ? 70
    : clamp100(avgTtftMs <= cfg.ttftGoodMs
      ? 100
      : avgTtftMs >= cfg.ttftBadMs
        ? 0
        : 100 * (1 - (avgTtftMs - cfg.ttftGoodMs) / (cfg.ttftBadMs - cfg.ttftGoodMs)));
  const avgTps = tpsList.length > 0 ? tpsList.reduce((a, b) => a + b, 0) / tpsList.length : null;
  const throughput = avgTps == null ? 70 : clamp100(100 * (avgTps / cfg.tpsTarget));
  const score = Math.round(clamp100(0.5 * reliability + 0.3 * speed + 0.2 * throughput));
  const status: HealthStatus = score < cfg.threshold ? "critical" : score < cfg.atRisk ? "at_risk" : "healthy";
  return {
    score, reliability: Math.round(reliability), speed: Math.round(speed), throughput: Math.round(throughput),
    samples: n, errorRate: Math.round((failures / n) * 100), avgTtftMs: avgTtftMs == null ? null : Math.round(avgTtftMs),
    avgTps: avgTps == null ? null : Math.round(avgTps * 10) / 10,
    atRisk: status !== "healthy", critical: status === "critical", status,
  };
}
