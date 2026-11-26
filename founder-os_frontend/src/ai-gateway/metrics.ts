// ai-gateway/metrics.ts — display helpers for health + probe timings.
import type { AiHealthConfig, AiKeyHealth } from "./types";

export type HealthBand = "healthy" | "at_risk" | "critical" | "unknown" | "off";

export function healthBand(health: AiKeyHealth | null, enabled = true, cfg?: AiHealthConfig): HealthBand {
  if (!enabled) return "off";
  if (!health || !health.samples) return "unknown";
  const critical = cfg?.threshold ?? 40;
  const risky = cfg?.atRisk ?? 60;
  if (health.score < critical) return "critical";
  if (health.score < risky) return "at_risk";
  return "healthy";
}

export const HEALTH_LABEL: Record<HealthBand, string> = {
  healthy: "Healthy",
  at_risk: "At risk",
  critical: "Critical",
  unknown: "No data",
  off: "Disabled",
};

/** Tailwind classes (already used across Settings) per band. */
export function healthTone(band: HealthBand): string {
  switch (band) {
    case "healthy": return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
    case "at_risk": return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30";
    case "critical": return "bg-red-500/10 text-red-500 border-red-500/30";
    case "off": return "bg-[var(--bg-input)] text-[var(--text-tertiary)] border-[var(--border-card)]";
    default: return "bg-[var(--bg-input)] text-[var(--text-secondary)] border-[var(--border-card)]";
  }
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function fmtTps(tps: number | null | undefined): string {
  if (tps == null || !Number.isFinite(tps)) return "—";
  return `${tps.toFixed(1)} tok/s`;
}

export function healthTitle(health: AiKeyHealth | null): string {
  if (!health) return "No telemetry yet";
  return [
    `score ${health.score}/100`,
    `reliability ${health.reliability ?? "—"}`,
    `speed ${health.speed ?? "—"}`,
    `throughput ${health.throughput ?? "—"}`,
    `${health.samples} calls`,
    health.lastErrorKind ? `last error: ${health.lastErrorKind}` : "",
  ].filter(Boolean).join(" · ");
}
