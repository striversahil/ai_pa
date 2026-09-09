// Canonical live-update event catalog + broadcast helper.
//
// Every dashboard data-write path should call `broadcastLive(c, LiveEvent.X)`
// so open tabs refetch instantly via the EventHub WebSocket (/api/events).
// The hub is backing-store agnostic; `broadcastLive` is a no-op when EVENT_HUB
// is not bound (e.g. local/dev without the Durable Object).

export const LiveEvent = {
  Estimates: "estimates",
  Baseline: "baseline",
  Neodove: "neodove",
  Automation: "automation",
  Messages: "messages",
  Digests: "digests",
  Tasks: "tasks",
  Brief: "brief",
  PendingItems: "pending-items",
  FounderNotes: "founder-notes",
  Contacts: "contacts",
  Brain: "brain",
  Email: "email",
  Automations: "automations",
  Marketing: "marketing",
  Sheet: "sheet",
  Enquiries: "enquiries",
  Autopilot: "autopilot",
  /** CRM sales-order pipeline snapshot refreshed by the GH runner. */
  Crm: "crm",
  Chat: "chat",
  /**
   * Generic "data changed somewhere" event, emitted automatically by the
   * auto-live middleware for ANY mutating /api/* request whose handler did not
   * already broadcast a typed event. Frontends that subscribe to everything
   * (the default for new dashboards — omit `events` in useLiveQuery) refetch on
   * this, so a brand-new endpoint/view goes live with ZERO wiring.
   */
  DataChanged: "data-changed",
} as const;

export type LiveEventType = (typeof LiveEvent)[keyof typeof LiveEvent];

/**
 * Marker set on the Hono context when a handler broadcasts (typed) live events,
 * so the auto-live middleware knows NOT to double-emit a generic `data-changed`.
 */
export const LIVE_BROADCAST_MARKER = Symbol.for("founder.liveBroadcasted");

export function markLiveBroadcasted(c: any): void {
  try { c[LIVE_BROADCAST_MARKER] = true; } catch { /* noop */ }
}

export function hasLiveBroadcasted(c: any): boolean {
  try { return !!c[LIVE_BROADCAST_MARKER]; } catch { return false; }
}

export function broadcastLive(
  c: any,
  type: string,
  extra: Record<string, unknown> = {},
): void {
  try {
    markLiveBroadcasted(c);
    const ns = c.env && c.env.EVENT_HUB;
    if (!ns) return;
    const stub = ns.get(ns.idFromName("global"));
    if (c.executionCtx && typeof c.executionCtx.waitUntil === "function") {
      c.executionCtx.waitUntil(
        stub
          .fetch(
            new Request("https://hub/broadcast", {
              method: "POST",
              body: JSON.stringify({ type, ...extra }),
            }),
          )
          .catch(() => {}),
      );
    }
  } catch {
    /* never block the write path */
  }
}
