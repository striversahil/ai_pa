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
  Chat: "chat",
} as const;

export type LiveEventType = (typeof LiveEvent)[keyof typeof LiveEvent];

export function broadcastLive(
  c: any,
  type: string,
  extra: Record<string, unknown> = {},
): void {
  try {
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
