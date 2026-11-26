// ai-gateway-parts/metrics.ts — per-call telemetry that feeds key health.
//
// The gateway emits ONE metric per provider call (success or final failure).
// The Worker wires the sink to D1 (worker/ai-gateway-health.ts#recordKeyCall);
// the Express/runner paths simply leave the sink unset, so nothing changes
// there. Pure + edge-safe: no imports beyond types.
import type { CompletionRequest } from "./types";

export type GatewayErrorKind = "auth" | "quota" | "rate_limit" | "timeout" | "network" | "server" | "bad_response" | "unknown";

/** How much a failure of this kind should hurt a key's reliability score.
 *  A revoked key is fatal (1.0); a plain throttle is mostly the provider's
 *  schedule, so it barely moves the needle (0.2). */
export const GATEWAY_ERROR_WEIGHTS: Record<GatewayErrorKind, number> = {
  auth: 1,
  quota: 1,
  rate_limit: 0.2,
  timeout: 0.7,
  network: 0.7,
  server: 0.4,
  bad_response: 0.5,
  unknown: 0.4,
};

/** Errors that mean THIS key is dead until a human acts (auto-disable after
 *  three in a row; see worker/ai-gateway-health.ts). */
export const FATAL_ERROR_KINDS: ReadonlySet<GatewayErrorKind> = new Set(["auth", "quota"]);

export function classifyGatewayError(status: number | null | undefined, message: string): GatewayErrorKind {
  const msg = String(message ?? "");
  const s = Number(status ?? 0);
  // HTTP status wins over words in the body: a 503 whose error text happens to
  // contain "quota" is an upstream outage, NOT a dead key. Classifying it as
  // quota made three transient 503s permanently disable every free key.
  if (s === 401 || s === 403 || /\b(401|403)\b|unauthorized|invalid api key|invalid_api_key/i.test(msg)) return "auth";
  if (s === 402) return "quota";
  if (s === 429) return "rate_limit";
  if (s >= 500) return "server";
  if (/timeout|timed out|abort|ETIMEDOUT|EAI_AGAIN/i.test(msg)) return "timeout";
  if (/ECONN|ENOTFOUND|fetch failed|socket|network/i.test(msg)) return "network";
  if (/quota|billing|insufficient|exceeded your current/i.test(msg)) return "quota";
  if (/\b5\d\d\b|internal server|bad gateway|unavailable/i.test(msg)) return "server";
  if (/json|parse|unexpected token|empty response|no choices/i.test(msg)) return "bad_response";
  return "unknown";
}

export interface GatewayCallMetric {
  provider: string;
  keyId: string;
  ok: boolean;
  status?: number | null;
  errorKind?: GatewayErrorKind | null;
  /** Whole-call wall clock (retries included). */
  latencyMs: number;
  /** Time to the first streamed token. Absent for non-streamed calls — a
   *  non-stream response has no observable first-token boundary. */
  ttftMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  streamed?: boolean;
  /** "app" (default) or "playground". Playground rows stay in the ledger but
   *  never move a key's health score. */
  source?: string;
  at?: number;
}

type MetricSink = (metric: GatewayCallMetric) => void;
let sink: MetricSink | null = null;

/** Wire the D1 writer (Worker) or clear it (tests). Never throws. */
export function setGatewayMetricSink(fn: MetricSink | null): void {
  sink = typeof fn === "function" ? fn : null;
}

export function emitGatewayMetric(metric: Omit<GatewayCallMetric, "at">): void {
  if (!sink) return;
  try {
    sink({ ...metric, at: Date.now() });
  } catch { /* telemetry must never break a call */ }
}

/** Convenience for the gateway: is this request a playground probe? */
export function metricSource(req: Pick<CompletionRequest, "source">): string {
  return String(req.source ?? "app").slice(0, 24) || "app";
}
