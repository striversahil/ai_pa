// Extracted verbatim from engine.ts by scripts/refactor/split-module.mjs.
// engine.ts re-exports everything public here, so existing imports keep working.
import type { CopilotDef, CopilotProposal } from "../types";
import { resolveChatModel, paidRouteParams } from "../../shared/intake-chain";
import { ROOT_EMAIL } from "../../modules/auth/types";

export const MAX_STEPS = 6;

export const COUNT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Chat primary (2026-10-06 paid lane → 2026-10-13 Agnes-first): the chain in
// shared/intake-chain.ts serves agnes-3.0-flash via the GH relay lane ONLY,
// with the paid OpenRouter lane (deepseek/deepseek-v4.1-flash,
// streamlake/fp8 preferred, OpenRouter fallback allowed) as fallback.
// Direct Cloudflare egress is never attempted for Agnes (WAF-blocked).
// A fully-exhausted chain answers "busy" instead of guessing from a
// hallucinating fallback model.
export const BUSY_REPLY = 'The AI is busy (rate-limited) — please retry in a minute.';

/** Legacy single-provider pin (kept exported for compat — the loop now walks
 *  resolveChatChain instead). Paid-only keys; free-tier keys never serve chat. */
export const CHAT_PROVIDER = 'openrouter-paid';

/** Paid-leg routing is root-controlled (`chat:paid_route` + mode) via
 *  paidRouteParams() — empty route reproduces the compiled StreamLake/FP8
 *  default. Passed explicitly so the intent stays visible at the call site. */
/** Per-leg request params for one chat step: Agnes legs run relay-only with
 *  brief thinking (THINK_BRIEF parity at minimal token cost); the paid leg
 *  keeps the existing routing params. Every leg is strictly pinned with the
 *  same sticky sessionKey — no mid-chat key hopping. */
export function chatLegParams(leg: string, def: CopilotDef<any>, env: any, models?: { agnesModel?: string; openrouterModel?: string; paidRoute?: string; paidRouteMode?: string }) {
  return {
    provider: leg,
    model: resolveChatModel(def, env, leg, models),
    extraParams: leg === 'openrouter-paid' ? paidRouteParams(models?.paidRoute ?? '', models?.paidRouteMode) : undefined,
    strictProvider: true,
    ...(leg === 'agnes' ? { agnesRelayOnly: true, reasoningEffort: 'low' as const } : {}),
  };
}

// Reasoning models burn completion tokens on chain-of-thought (reasoning
// counts against max_tokens) — big blobs think for thousands of tokens
// before answering, so chat budgets 16000 (founder order): room to think
// AND to reply. A step still cut off by the cap (finish=length, empty
// content, no tools) is auto-continued in-loop (≤2 per turn) instead of
// surfacing emptyHint. NOTE: attempts carry no timeout at all (founder
// order), so long generations are never killed before the tokens arrive.
export const CHAT_MAX_TOKENS = 16000;

/** NO time constraint on chat model calls (founder order): no per-attempt
 *  timeout, no first-data probe. A call lives until the provider answers or
 *  the connection itself errors. Price: a silently-dead channel hangs the
 *  turn instead of failing over — remedy is a fresh chat + retry. */
/** Nudge appended when a step was cut off by the token cap — resumes the
 *  turn instead of ending it on an empty step. */
export const CUT_RESUME = 'Your reply was cut off at the length limit — continue exactly where you left off, no preamble.';

export const MAX_CUT_RESUMES = 2;

export function parseArgs(raw: string): Record<string, any> {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

// ── Same-tool loop breaker ─────────────────────────────────────────────────
// A model that gets an inconclusive tool result (e.g. lookup candidates it
// won't pick from) retries the identical call hoping for a different answer —
// each retry appends kilobytes of tool output until the turn dies at the
// token cap ("ran out of space"). Mechanical guard, prompt-independent:
//   1st call → runs.
//   2nd identical call → runs, but the tool message carries a system nudge to
//     decide from existing results instead of calling again.
//   3rd+ identical call → NOT executed; a loop-blocked error tells the model
//     to answer from history. Bounded: worst case 2 real calls per signature.
// Signatures are arg-order/case-insensitive with capped lengths so trivial
// rewordings ("V belt" vs "v belt") count as the same call. Seeded from
// loaded history so a continued hop can't restart a loop the previous hop
// already ran.
export function toolSig(name: string, args: Record<string, any>): string {
  const norm = (v: unknown): unknown => {
    if (typeof v === 'string') return v.toLowerCase().trim().slice(0, 300);
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (Array.isArray(v)) return v.map(norm).slice(0, 20);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) o[k] = norm((v as any)[k]);
      return o;
    }
    return null;
  };
  let canon = '{}';
  try { canon = JSON.stringify(norm(args) ?? {}); } catch { /* keep {} */ }
  return `${String(name)}:${canon}`;
}

export function seedToolSigs(messages: any[]): Map<string, number> {
  const seen = new Map<string, number>();
  try {
    for (const m of (Array.isArray(messages) ? messages : [])) {
      const calls = (m as any)?.tool_calls;
      if (!Array.isArray(calls)) continue;
      for (const tc of calls) {
        const fn = (tc as any)?.function ?? {};
        let args: Record<string, any> = {};
        try { args = parseArgs(typeof fn.arguments === 'string' ? fn.arguments : '{}'); } catch { /* keep {} */ }
        const sig = toolSig(String(fn.name ?? ''), args);
        seen.set(sig, (seen.get(sig) ?? 0) + 1);
      }
    }
  } catch { /* fail-open: empty ledger */ }
  return seen;
}

/** System nudge appended to the 2nd identical tool result (not stored as a
 *  separate message — rides the tool output the model just received). */
export function repeatNudge(name: string): string {
  return `[System note: you already called ${name} with equivalent arguments and have its result above — do NOT call it again. Decide now: offer any returned candidates to the user for a pick, or answer from history.]`;
}

/** Loop-blocked pseudo-result for the 3rd+ identical call (never executed). */
export function blockedOut(name: string, times: number): { result: unknown; proposals?: CopilotProposal[] } {
  return {
    result: {
      error: 'loop-blocked',
      note: `STOP calling ${name} with these arguments — it already ran ${times}x this conversation with no new outcome, and further identical calls will also be blocked. Answer NOW from the earlier results: offer the candidates to the user for a pick, or reply from history.`,
    },
  };
}

/** "Starting" chime for a tool call (shown before it returns). */
export function startLabel<T>(def: CopilotDef<T>, name: string, args: Record<string, any>): string {
  try {
    const l = (def as any)?.activityStartLabel?.(name, args);
    if (l) return String(l);
  } catch { /* fall through */ }
  return `Running ${String(name ?? 'tool').replace(/_/g, ' ')}…`;
}

export function is429Like(e: any): boolean {
  const msg = String(e?.message ?? '');
  return /429|rate-limit|1015/i.test(msg) || (e as any)?.status === 429;
}

/** Max HUMAN turns per chat session (across tool steps). The 26th user
 *  message is refused with the limit reply — new chat (clear) resets it. */
export const MAX_HUMAN_TURNS = 25;

export const LIMIT_REPLY = 'Limit reached (25 chats) — open a new chat to continue.';

/**
 * Thinking discipline (all copilots): deepseek-v4-flash via OpenRouter has
 * NO thinking-token budget parameter (reasoning.max_tokens is not honored;
 * effort low/medium silently map to high), so the only real lever on
 * deliberation length is instruction + context size. This line rides every
 * system prompt: brief, non-repetitive internal reasoning, never
 * re-deriving settled facts. It cuts CoT length without touching quality
 * of the visible answer or the tools.
 */
export const THINK_BRIEF = '\n\nThink efficiently: keep internal reasoning brief and non-repetitive — state the plan once, act, and move on. Never re-derive settled facts or re-weigh decided options.';

export const RATE_WINDOW_MS = 60 * 60 * 1000;

export function rateWho(ctx: any): { id: string; root: boolean } {
  const me = (ctx as any)?.me;
  const email = String(me?.user?.email ?? '').toLowerCase();
  const id = (email || String(me?.user?.id ?? 'anon')).toLowerCase();
  const root = me?.isRoot === true || (email !== '' && email === ROOT_EMAIL.toLowerCase());
  return { id, root };
}

// ── Per-user daily usage log (MIS readout; survives the isolate) ──────────
// One AWAITED KV write per served turn (refused turns log nothing — this is
// why the old fire-and-forget turn counters never persisted). Keyed by user
// + UTC date, 90-day TTL. Root included — root turns cost the same.
export const USAGE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function usageKey(id: string, date = new Date()): string {
  return `copilot:usage:${date.toISOString().slice(0, 10)}:${id}`;
}
