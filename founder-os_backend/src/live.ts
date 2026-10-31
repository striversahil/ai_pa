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
   * Telecalling assignment/risk/roster writes (engine runs, MIS controller,
   * effort-sync). Typed member so refactors are compiler-checked — previously
   * a raw "telecalling" string at every call site.
   */
  Telecalling: "telecalling",
  /**
   * Accounts taskbar writes (daily logging, remarks, attachments, MIS
   * roster/template changes). Typed member so refactors are compiler-checked.
   */
  Accounts: "accounts",
  DigitalMarketing: "digital-marketing",
  /** Human Resources task/expense writes (roster, delegated tasks, ledger). */
  HumanResources: "human-resources",
  /** Debtors Tracker writes (paste imports, corrections, situation saves). */
  Debtors: "debtors",
  /** Product Line master writes (products, guide questions, vendors). */
  ProductLine: "product-line",
  /**
   * Reporting Sheet writes (one section save). Viewers refetch on this type;
   * the payload is tiny (a few dozen rows), so no narrow subscription needed.
   */
  Reporting: "reporting",
  /**
   * Customer master writes (record edits, duplicate-group review, JSON
   * re-import, editor appointments). Dashboards listening on this type refetch;
   * the master table deliberately does NOT subscribe to the generic
   * `data-changed` event — its payload is ~2.6k rows and must not reload every
   * time an unrelated screen saves something.
   */
  MasterData: "master-data",
  /**
    * Agent call-disposition tag tap (Lead Conversion view). Deliberately NOT
   * "telecalling": dashboards refetch wholesale on that type, and a tag save
   * would fan out into ~20 requests (leaderboard + generation + roster + every
   * agent view). The tag delta rides INSIDE this event and each tab patches
   * the single row locally (Sheets-style) — 1 PUT + 1 light reconcile fetch
   * per tap. The post-cache tag overlay guarantees the next full read agrees.
   */
  TelecallingTag: "telecalling-tag",
  /**
   * NeoDove campaign lead pushes (Controller tab). Fires on batch create and
   * on completion only — the chunk endpoint is opted out of auto-live so a
   * 260-lead push cannot refetch every open dashboard 13 times.
   */
  NeodoveCampaign: "neodove-campaign",
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
