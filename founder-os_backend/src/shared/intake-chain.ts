// intake-chain.ts — single AI gateway chain, single source of truth.
//
// The chain IS the Setting `ai:providers` list order (root-managed in the
// Settings UI), with any env-configured pool keys not in the list appended
// as fallback legs. Every AI caller — copilot chat, enquiry extraction,
// vision intake, catalogue lookup, runners via POST /api/ai/complete — walks
// this one chain with the same sticky sessionKey. No per-task providers,
// no relay lanes, no paid-leg special-casing.
import { getGateway } from './ai-gateway';
import { getAppSettings, parseAiProvidersJson } from './app-settings';

export interface AiLeg {
  provider: string;
  model?: string;
}

/**
 * Ordered legs for one AI turn. forceProvider pins a single leg
 * (bulk backfills — no failover); an unknown/unhealthy pin resolves to []
 * so the caller skips instead of serving a substituted provider.
 */
export async function resolveAiChain(
  env: Record<string, unknown>,
  forceProvider?: string,
): Promise<AiLeg[]> {
  let health: Array<{ provider?: string; enabled?: boolean; cooldownUntil?: number }> = [];
  let order: Array<{ id: string; model: string }> = [];
  try {
    const gw = getGateway(env as any);
    let settings: Record<string, string> = {};
    try {
      settings = await getAppSettings();
      gw.configureFromSettings(settings as any);
    } catch { /* env pool only */ }
    health = gw.health();
    const cfg = parseAiProvidersJson(String(settings?.['ai:providers'] ?? ''));
    if (cfg) order = cfg.providers.map((p) => ({ id: p.id, model: p.model }));
  } catch {
    return [];
  }
  const now = Date.now();
  const usable = new Set(
    health.filter((h) => h?.provider && h.enabled !== false && (h.cooldownUntil ?? 0) <= now)
      .map((h) => String(h.provider)),
  );
  if (usable.size === 0) return [];
  const modelOf = new Map(order.map((o) => [o.id, o.model]));
  if (forceProvider) {
    const f = String(forceProvider).trim();
    if (!f || !usable.has(f)) return [];
    return [{ provider: f, model: modelOf.get(f) || undefined }];
  }
  const legs: AiLeg[] = [];
  for (const o of order) {
    if (usable.has(o.id)) legs.push({ provider: o.id, model: o.model || undefined });
  }
  // Env-configured pool providers not in the Setting list (legacy keys,
  // fallback) ride last in stable order.
  for (const p of [...usable].sort()) {
    if (!modelOf.has(p) && !legs.some((l) => l.provider === p)) legs.push({ provider: p });
  }
  return legs;
}
