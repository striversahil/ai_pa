// copilot/session.ts — shared conversation-memory for EVERY AI copilot.
//
// Extracted verbatim from copilot/engine.ts: session ids, rolling history,
// tool-trace + reasoning carry-forward, confirm-path notes, epochs, and
// new-chat wipe. Intake, sales, and any future department copilot ride the
// same keys and the same clear semantics — a fix here (e.g. a forgotten
// key on clear) fixes all copilots at once. Pure KV + types; no gateway,
// no model calls, edge-safe (fetch only).
import { cacheDel, cacheGet, cacheSet } from '../shared/cache';
import type { ChatMessage } from '../shared/ai-gateway';
import type { CopilotDef } from './types';

const SESSION_TTL_MS = 30 * 60 * 1000;

interface HistMsg { role: 'user' | 'assistant'; text: string; }


/** Load rolling history (user/assistant texts only — tool payloads stay out).
 *  Storage keeps the full window (e.g. 50 requests); each turn SENDS only a
 *  compact slice — recent messages near-verbatim, older ones as gist lines —
 *  so prompt size stays bounded no matter how long the chat runs. */
const SEND_RECENT = 12;
const RECENT_CAP = 1200;
const GIST_CAP = 120;
export async function loadHistory<T>(def: CopilotDef<T>, ctx: T): Promise<{ messages: ChatMessage[]; userTurns: number }> {
  try {
    const key = def.historyKey?.(ctx);
    if (!key) return { messages: [], userTurns: 0 };
    const ttl = def.historyTtlMs ?? SESSION_TTL_MS;
    const past = ((await cacheGet<HistMsg[]>(key, ttl)) ?? []).filter(
      (m) => (m?.role === 'user' || m?.role === 'assistant') && String(m?.text ?? '').trim(),
    );
    const userTurns = past.filter((m) => m.role === 'user').length;
    const recent = past.slice(-SEND_RECENT);
    const older = past.slice(0, Math.max(0, past.length - SEND_RECENT));
    const recentCap = def.historyRecentCap ?? RECENT_CAP;
    const messages: ChatMessage[] = [
      ...older.map((m) => ({ role: m.role, content: String(m.text).slice(0, GIST_CAP) })),
      ...recent.map((m) => ({ role: m.role, content: String(m.text).slice(0, recentCap) })),
    ];
    // Total prompt budget: trim oldest-first so one giant paste (or a long
    // chat) can never overflow the model's context. Default 24k sits above
    // what default per-message caps can produce — other defs unaffected.
    const totalCap = def.historyTotalCap ?? 24_000;
    let total = messages.reduce((n, m) => n + String((m as any)?.content ?? '').length, 0);
    while (messages.length > 1 && total > totalCap) {
      const dropped = messages.shift()!;
      total -= String((dropped as any)?.content ?? '').length;
    }
    return { messages, userTurns };
  } catch {
    return { messages: [], userTurns: 0 };
  }
}

/** Tool-output carry-forward (keepToolOutputs defs only): last turn's tool
 *  results, appended to the next turn's system prompt so "continue" truly
 *  continues. Bounded (12k chars default, def.traceCap overrides) — big
 *  reads fit, history stays cheap. Flushed per step, not just at turn end. */
const TRACE_CAP = 12_000;
export async function loadToolTrace<T>(def: CopilotDef<T>, ctx: T): Promise<string> {
  try {
    if (!def.keepToolOutputs) return '';
    const key = def.historyKey?.(ctx);
    if (!key) return '';
    const t = await cacheGet<string>(`${key}:trace`, def.historyTtlMs ?? SESSION_TTL_MS);
    return typeof t === 'string' ? t : '';
  } catch {
    return '';
  }
}
export async function saveToolTrace<T>(def: CopilotDef<T>, ctx: T, parts: string[], epoch?: number | null): Promise<void> {
  try {
    if (!def.keepToolOutputs || !parts.length) return;
    if (!(await epochCurrent(def, ctx, epoch))) return;
    const key = def.historyKey?.(ctx);
    if (!key) return;
    const ttl = def.historyTtlMs ?? SESSION_TTL_MS;
    const cap = def.traceCap ?? TRACE_CAP;
    const prev = (await cacheGet<string>(`${key}:trace`, ttl)) ?? '';
    const combined = [...parts, ...(prev ? [prev] : [])].join('\n').slice(0, cap);
    await cacheSet(`${key}:trace`, combined, ttl);
  } catch { /* best-effort */ }
}

/** Reasoning carry-forward: the model's deliberation is echoed on the next
 *  call (assistant-message `reasoning`, which DeepSeek-style models require
 *  for tool chains and which keeps continued hops mid-thought) and survives
 *  transport yields in KV. Bounded: per-message cap + stored-window cap
 *  (tail kept — the latest deliberation is what continuation needs).
 *  Best-effort throughout; a miss only costs re-thinking, never correctness. */
const REASON_MSG_CAP = 6000;
const REASON_STORE_CAP = 12_000;
export const capReason = (t: unknown): string => String(t ?? '').trim().slice(-REASON_MSG_CAP);
export async function loadReasoning<T>(def: CopilotDef<T>, ctx: T): Promise<string> {
  try {
    const key = def.historyKey?.(ctx);
    if (!key) return '';
    const t = await cacheGet<string>(`${key}:reason`, def.historyTtlMs ?? SESSION_TTL_MS);
    return typeof t === 'string' ? t : '';
  } catch {
    return '';
  }
}
export async function saveReasoning<T>(def: CopilotDef<T>, ctx: T, text: string, epoch?: number | null): Promise<void> {
  try {
    if (!String(text ?? '').trim()) return;
    if (!(await epochCurrent(def, ctx, epoch))) return;
    const key = def.historyKey?.(ctx);
    if (!key) return;
    await cacheSet(`${key}:reason`, String(text).slice(-REASON_STORE_CAP), def.historyTtlMs ?? SESSION_TTL_MS);
  } catch { /* best-effort */ }
}

/** History is saved INCREMENTALLY, never only at turn end: the user's
 *  message lands in KV before the first model call, each step's tool
 *  outputs flush as they happen, and the assistant reply closes the turn.
 *  A turn killed mid-flight (client abort, exception, isolate freeze) still
 *  leaves resumable state — "continue" sees the blob AND the partial work.
 *  Skipped when stateless. */
export async function saveUserTurn<T>(def: CopilotDef<T>, ctx: T, userText: string, epoch?: number | null): Promise<void> {
  try {
    if (!(await epochCurrent(def, ctx, epoch))) return;
    const key = def.historyKey?.(ctx);
    if (!key || !String(userText ?? '').trim()) return;
    const ttl = def.historyTtlMs ?? SESSION_TTL_MS;
    const max = def.historyMaxMsgs ?? 12;
    const storeCap = def.historyStoreCap ?? 1500;
    const past = (await cacheGet<HistMsg[]>(key, ttl)) ?? [];
    const next = [...past, { role: 'user' as const, text: String(userText).slice(0, storeCap) }];
    await cacheSet(key, next.slice(-max), ttl);
  } catch { /* best-effort */ }
}
export async function saveAssistantReply<T>(def: CopilotDef<T>, ctx: T, replyText: string, epoch?: number | null): Promise<void> {
  try {
    if (!(await epochCurrent(def, ctx, epoch))) return;
    const key = def.historyKey?.(ctx);
    if (!key || !String(replyText ?? '').trim()) return;
    const ttl = def.historyTtlMs ?? SESSION_TTL_MS;
    const max = def.historyMaxMsgs ?? 12;
    const storeCap = def.historyStoreCap ?? 1500;
    const past = (await cacheGet<HistMsg[]>(key, ttl)) ?? [];
    const next = [...past, { role: 'assistant' as const, text: String(replyText).slice(0, storeCap) }];
    await cacheSet(key, next.slice(-max), ttl);
  } catch { /* best-effort */ }
}

export async function markStorm(): Promise<void> {
  try { await cacheSet('ai:storm:chat', { at: Date.now() }, 120_000); } catch { /* best-effort */ }
}

/**
 * Confirm-path memory: after the user hits Confirm/Apply, the write must
 * land in THIS thread's history — otherwise the model never learns it
 * happened and re-derives (or re-proposes) from stale context on the next
 * turn. Called by every /chat/execute route after executeProposal settles,
 * success or failure. Raw-key form so store-bound routes (sales) without a
 * CopilotDef ctx can use it too. Deliberately no epoch gate: a confirm is
 * an explicit user act on a visible card.
 */
export async function appendHistoryNote(key: string | null | undefined, ttlMs: number, text: string): Promise<void> {
  try {
    if (!key || !String(text ?? '').trim()) return;
    const past = (await cacheGet<HistMsg[]>(key, ttlMs)) ?? [];
    const next = [...past, { role: 'assistant' as const, text: String(text).slice(0, 1500) }];
    await cacheSet(key, next.slice(-100), ttlMs);
  } catch { /* best-effort */ }
}

/** One-line applied/failed record for appendHistoryNote. Capped, no payloads. */
export function appliedNote(action: Record<string, any>, applied: string, body: any): string {
  const label = String(action?.label ?? action?.kind ?? applied).slice(0, 160);
  if (!applied || applied === 'none') {
    return `✗ Apply failed: ${label} — ${String(body?.error ?? 'rejected').slice(0, 200)}`;
  }
  const b = (body ?? {}) as Record<string, any>;
  const bits: string[] = [];
  if (Array.isArray(b.filed)) bits.push(`${b.filed.length} filed`);
  if (Array.isArray(b.failed) && b.failed.length) bits.push(`${b.failed.length} failed`);
  if (b.rateId) bits.push(`rate ${String(b.rateId).slice(0, 8)}`);
  if (b.id) bits.push(`id ${String(b.id).slice(0, 8)}`);
  if (b.expectedRate != null) bits.push(`expected ₹${b.expectedRate}`);
  if (typeof b.items === 'number') bits.push(`${b.items} items`);
  return `✓ Applied: ${label}${bits.length ? ` (${bits.join(', ')})` : ''}`;
}

// ── Hourly user-turn budget (20/hr default, non-root only) ─────────────────
// One token per USER turn, consumed at turn entry in runTurn/streamTurn. The
// LLM's own tool steps (up to MAX_STEPS gateway calls per turn) never touch
// this counter — only the human's request counts. Fixed window via stored
// resetAt (KV TTL refreshes on every set, so TTL alone would slide).

/** Volatile session id: the client mints one per visible conversation and
 *  sends it with every message. Memory (history + trace + epoch) is keyed
 *  under it — a new chat mints a new id, so the old thread is simply
 *  unreachable (KV TTL reaps it). Normal-LLM behaviour: memory lives exactly
 *  as long as the conversation on screen. Absent = legacy user-keyed memory. */
export function cleanSession(v: unknown): string {
  return String((v as any) ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

/** Chat epoch: bumped on every new-chat. Turns capture it at entry and
 *  every save refuses to write when it moved — so a turn still running (or
 *  a killed turn's generator limping on server-side) can never resurrect
 *  memory the user just cleared. */
export async function readEpoch<T>(def: CopilotDef<T>, ctx: T): Promise<number | null> {
  try {
    const key = def.historyKey?.(ctx);
    if (!key) return null;
    return (await cacheGet<number>(`${key}:epoch`, def.historyTtlMs ?? SESSION_TTL_MS)) ?? 0;
  } catch {
    return 0;
  }
}
async function epochCurrent<T>(def: CopilotDef<T>, ctx: T, epoch: number | null | undefined): Promise<boolean> {
  if (epoch === null || epoch === undefined) return true;
  return (await readEpoch(def, ctx)) === epoch;
}

/** New-chat: wipe rolling history + any copilot extras (e.g. intake draft). */
export async function clearState<T>(def: CopilotDef<T>, ctx: T): Promise<void> {
  try {
    const key = def.historyKey?.(ctx);
    // History + carried-forward tool trace go together, or "new chat" lies.
    if (key) await cacheDel(key);
    if (key) await cacheDel(`${key}:trace`).catch(() => {});
    // Deliberation carry-forward must die too — otherwise the next turn
    // resurrects the wiped thread's thinking and "clear didn't work".
    if (key) await cacheDel(`${key}:reason`).catch(() => {});
    // Copilot scratch state (e.g. intake's per-chat draft registry) dies
    // with the chat too — a new conversation must never inherit old claims.
    if (key) await cacheDel(`${key}:prop`).catch(() => {});
    // Bump AFTER wiping: any in-flight turn holds the old epoch and all
    // its subsequent saves (user msg, per-step trace, reply) are refused.
    if (key) await cacheSet(`${key}:epoch`, Date.now(), def.historyTtlMs ?? SESSION_TTL_MS).catch(() => {});
  } catch { /* best-effort */ }
  try {
    await def.clearExtra?.(ctx);
  } catch { /* best-effort */ }
}

