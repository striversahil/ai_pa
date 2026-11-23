// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/sweep.ts — the `* * * * *` cron arm.
//
// Runs on every scheduled fire (the router already fires every minute). It does
// NO work unless a rule's `nextDueAt` has passed, so an idle tick costs one
// indexed D1 read. Windows are anchored on the SLOT (never wall-clock), which
// keeps a late-delivered cron event from shifting "last hour".
//
// Never throws: one broken rule can never stop the dispatcher, and a failing
// rule records its error in `lastStatus` so the console shows it.
// ─────────────────────────────────────────────────────────────────────────────
import { evaluateRule } from "./engine";
import { dueRules, loadNotificationConfig, markRuleRun } from "./store";
import { nextDueAt } from "./window";

export interface SweepResult {
  due: number;
  dispatched: number;
  rules: string[];
  errors: string[];
}

/** Fire-and-forget broadcast into the EventHub (same shape as live.ts). */
async function broadcast(env: any, payload: Record<string, unknown>): Promise<void> {
  try {
    const hub = (env as any)?.EVENT_HUB;
    if (!hub || typeof hub.idFromName !== "function") return;
    const stub = hub.get(hub.idFromName("global"));
    await stub
      .fetch(new Request("https://hub/broadcast", { method: "POST", body: JSON.stringify(payload) }))
      .catch(() => null);
  } catch { /* never block the sweep */ }
}

export async function runNotificationSweep(
  env: any,
  slot: Date,
  ctx?: { waitUntil(p: Promise<unknown>): void },
): Promise<SweepResult> {
  const out: SweepResult = { due: 0, dispatched: 0, rules: [], errors: [] };
  const db = (env as any)?.DB;
  if (!db || typeof db.prepare !== "function") return out;

  try {
    const config = await loadNotificationConfig(db);
    const due = await dueRules(db, slot.toISOString(), config.settings.sweepRulesPerTick);
    out.due = due.length;
    if (due.length === 0) return out;

    for (const rule of due) {
      try {
        const result = await evaluateRule(db, rule, {
          slot,
          levels: config.levels,
          settings: config.settings,
        });
        const nextDue = nextDueAt(rule.cadence, slot);
        await markRuleRun(db, rule.key, nextDue ? nextDue.toISOString() : null, {
          at: slot.toISOString(),
          scanned: result.scanned,
          matched: result.matched,
          dispatched: result.dispatched,
          skipped: result.skipped,
          errors: result.errors,
          unmatched: result.unmatched.slice(0, 10),
        });
        out.dispatched += result.dispatched;
        out.rules.push(rule.key);
        if (result.errors.length > 0) out.errors.push(`${rule.key}: ${result.errors[0]}`);
        if (result.dispatched > 0) {
          const payload = { type: "notifications", ruleKey: rule.key, count: result.dispatched };
          if (ctx?.waitUntil) ctx.waitUntil(broadcast(env, payload));
          else await broadcast(env, payload);
        }
      } catch (e: any) {
        out.errors.push(`${rule.key}: ${String(e?.message ?? e).slice(0, 200)}`);
        try {
          const nextDue = nextDueAt(rule.cadence, slot);
          await markRuleRun(db, rule.key, nextDue ? nextDue.toISOString() : null, {
            at: slot.toISOString(), error: String(e?.message ?? e).slice(0, 500),
          });
        } catch { /* never throw from the sweeper */ }
      }
    }
  } catch (e: any) {
    out.errors.push(String(e?.message ?? e).slice(0, 200));
  }
  return out;
}
