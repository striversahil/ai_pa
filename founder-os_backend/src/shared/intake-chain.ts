// intake-chain.ts — intake provider order, single source of truth.
//
// Agnes-pool first (random key spread + per-key 429 cool/rotate inside the
// provider), paid OpenRouter fallback only. The free leg is dropped on
// purpose (founder 2026-10-13): intake quality must be deterministic —
// free-model variance caused names-only content drops. Groq keys never load
// (founder rule, enforced in the gateway pool).
//
// Consumers: vision-intake.ts (Add-via-AI / new-items intake), extract.ts
// (field extraction). Chat legs below serve copilot/engine.ts. JS mirror
// for GH runners: scripts/ai-gateway.js
// resolveIntakeChain (same order, same pin semantics).
import { getGateway, PAID_CHAT_ROUTING } from './ai-gateway';

/**
 * Ordered provider legs for one intake turn. forceProvider pins a single leg
 * (bulk backfills — no failover); unknown/empty leg resolves to [] so the
 * caller skips instead of burning spend on a substituted provider.
 * `opts.primary` (the `intake:primary_provider` Setting) serves first.
 */
export function resolveIntakeChain(env: Record<string, unknown>, forceProvider?: string, opts?: { primary?: string }): string[] {
  let health: Array<{ provider?: string }>;
  try {
    health = getGateway(env as any).health();
  } catch {
    return [];
  }
  const has = (p: string): boolean => health.some((h) => h?.provider === p);
  if (forceProvider) return has(forceProvider) ? [forceProvider] : [];
  return orderLegs(has, opts?.primary);
}

// Intake legs in priority order. `opts.primary` (a Setting override) serves
// first; unknown primaries fall back to the compiled default (Agnes first).
function orderLegs(has: (p: string) => boolean, primary?: string): string[] {
  const legs = ['agnes', 'openrouter-paid'];
  const first = primary && legs.includes(primary) ? primary : legs[0];
  return [first, ...legs.filter((l) => l !== first)].filter((l) => has(l));
}

// ── Chat chain ─────────────────────────────────────────────────────────────
// Same legs as intake (Agnes-pool first via the GH relay lane only, paid
// OpenRouter fallback), separate function so chat and intake can diverge.
// Callers pin each leg (strictProvider) with the same sticky sessionKey, so
// a conversation never hops keys mid-chat; a dead leg fails the whole chain
// to the next one. BUSY only when every leg is exhausted.
export function resolveChatChain(env: Record<string, unknown>, opts?: { primary?: string }): string[] {
  let health: Array<{ provider?: string }>;
  try {
    health = getGateway(env as any).health();
  } catch {
    return [];
  }
  const has = (p: string): boolean => health.some((h) => h?.provider === p);
  return orderLegs(has, opts?.primary);
}

/**
 * Per-leg chat model. The Agnes leg MUST use an Agnes model id — copilot
 * defs pin DeepSeek ids (defaultModel) that the Agnes API would reject with
 * 404. Precedence: Setting override (`chat:agnes_model`) → env
 * AGNES_CHAT_MODEL → agnes-3.0-flash (verified against official docs:
 * OpenAI-compatible, tools + streaming + 512K).
 */
export function resolveChatModel(
  def: { modelEnvVar?: string; defaultModel?: string },
  env: Record<string, unknown>,
  leg: string,
  opts?: { agnesModel?: string; openrouterModel?: string },
): string {
  if (leg === 'agnes') {
    const s = String(opts?.agnesModel ?? '').trim();
    if (s) return s;
    return String((env as any)?.AGNES_CHAT_MODEL ?? '').trim() || 'agnes-3.0-flash';
  }
  const o = String(opts?.openrouterModel ?? '').trim();
  if (o) return o;
  return String((env as any)?.[(def as any)?.modelEnvVar] ?? '').trim()
    || (def as any)?.defaultModel
    || 'deepseek/deepseek-v4.1-flash';
}

/**
 * Intake leg model override. Returns undefined when no override is set —
 * undefined means "provider default", so a leg never receives a model id it
 * didn't ask for (an Agnes id on the paid leg, or vice versa, would 404).
 */
export function resolveLegModel(leg: string, opts?: { agnesModel?: string; openrouterModel?: string }): string | undefined {
  if (leg === 'agnes') return String(opts?.agnesModel ?? '').trim() || undefined;
  if (leg === 'openrouter-paid') return String(opts?.openrouterModel ?? '').trim() || undefined;
  return undefined;
}

// ── Paid OpenRouter provider routing ───────────────────────────────────────
// Builds the OpenRouter `provider` routing param for paid legs from the
// root-controlled Settings (`chat:paid_route` + `chat:paid_route_mode`).
// Empty route → compiled default (PAID_CHAT_ROUTING: StreamLake/FP8
// preferred, fallbacks allowed). Mode `only` pins EXCLUSIVELY
// (allow_fallbacks false — fails when every listed provider is down);
// `prefer` tries the listed providers first, then falls back freely.
export function paidRouteParams(route: string, mode?: string): Record<string, unknown> {
  const slugs = String(route ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5);
  if (slugs.length === 0) return { ...PAID_CHAT_ROUTING };
  if (String(mode ?? '').trim().toLowerCase() === 'only') {
    return { provider: { only: slugs, allow_fallbacks: false } };
  }
  return { provider: { order: slugs, allow_fallbacks: true } };
}
