import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// useLiveData — ONE modular file that makes every dashboard number live.
//
// A single shared WebSocket connection to /api/events fans out to every hook
// instance via an in-process event bus, so the whole app uses one socket (not
// one per component). Each dashboard calls `useLiveQuery`, passing the API
// fetcher and the LiveEvent types that should trigger a refetch. The backend
// emits those types from every data-write path (see backend `src/live.ts`).
// Open tabs refetch within ~1.5s; no manual page refresh needed.
// ─────────────────────────────────────────────────────────────────────────────

export type LiveEvent = { type: string; [key: string]: unknown };

const PING_MS = 60_000;
const REFRESH_DEBOUNCE_MS = 1500;
/**
 * No fetch may spin forever: any query still unsettled after this long is
 * failed as a timeout (error state + retry) instead of an eternal spinner.
 * 30s covers even cold-cache computes (~5s observed) with wide margin.
 */
const FETCH_TIMEOUT_MS = 30_000;

// ── Module-level singleton: one socket + one event bus for the whole app ──
const bus = new EventTarget();
let socket: WebSocket | null = null;
let attempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;

function connect() {
  // SSR-safe: Node ≥22 exposes a global WebSocket, so the old guard passed and
  // `window.location` threw during static export. Guard on window instead.
  if (typeof window === "undefined" || typeof WebSocket === "undefined") return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  try {
    socket = new WebSocket(`${proto}//${window.location.host}/api/events`);
  } catch {
    scheduleRetry();
    return;
  }
  socket.onopen = () => { attempts = 0; };
  socket.onmessage = (ev) => {
    try {
      const data = JSON.parse(String(ev.data)) as LiveEvent;
      if (data && typeof data.type === "string" && data.type !== "hello") {
        bus.dispatchEvent(new CustomEvent<LiveEvent>("live", { detail: data }));
      }
    } catch { /* ignore malformed frames */ }
  };
  socket.onclose = () => { socket = null; scheduleRetry(); };
  socket.onerror = () => { try { socket?.close(); } catch { /* noop */ } };
}

function scheduleRetry() {
  attempts += 1;
  retryTimer = setTimeout(connect, Math.min(30_000, 1500 * attempts));
}

connect();
pingTimer = setInterval(() => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    try { socket.send("ping"); } catch { /* noop */ }
  }
}, PING_MS);

export interface UseLiveQueryOptions {
  /** Event types (or predicate) that should trigger a refetch. Omit = any event. */
  events?: string[] | ((e: LiveEvent) => boolean);
  /** Re-fetch when these values change (same semantics as useEffect deps). */
  deps?: unknown[];
  /** Optional slow polling safety net in ms (e.g. 60000). */
  pollMs?: number;
  /**
   * When true, a failed refetch CLEARS the previous data instead of keeping
   * the stale view on screen (prevents misreading old numbers as current).
   */
  clearOnError?: boolean;
  /** Per-query timeout override in ms (default 30s — never spin forever). */
  timeoutMs?: number;
}

export interface LiveQueryResult<T> {
  data: T | null;
  /**
   * FIRST-PAINT flag: true only until the first payload arrives (or while a
   * `deps` change is loading a different dataset). A live-event refetch or a
   * poll NEVER sets this — use `refreshing` for those. Render a full-page
   * spinner/empty state on `loading`, and at most a subtle indicator on
   * `refreshing`.
   */
  loading: boolean;
  /** A background refetch (live event / poll) is in flight while data is shown. */
  refreshing: boolean;
  error: unknown;
  refresh: () => void;
  /**
   * Direct state write (functional or value) — for SURGICAL updates that must
   * not trigger a full refetch (e.g. merging one agent's view after a tag
   * save instead of re-fetching every agent). Prefer refresh() unless you can
   * prove the patch is complete; a wrong patch shadows server state until the
   * next event-driven refetch.
   */
  setData: Dispatch<SetStateAction<T | null>>;
}

export function useLiveQuery<T>(
  fetcher: () => Promise<T>,
  options: UseLiveQueryOptions = {},
): LiveQueryResult<T> {
  const { events, deps = [], pollMs, clearOnError, timeoutMs = FETCH_TIMEOUT_MS } = options;
  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** Mirrors `data` for the refresh path (avoids a stale closure in `run`). */
  const dataRef = useRef<T | null>(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const clearOnErrorRef = useRef(clearOnError);
  clearOnErrorRef.current = clearOnError;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const timeoutMsRef = useRef(timeoutMs);
  timeoutMsRef.current = timeoutMs;

  /** Direct state write that also keeps `dataRef` in sync (see setData below). */
  const setData = useCallback<Dispatch<SetStateAction<T | null>>>((value) => {
    setDataState((prev) => {
      const next = typeof value === "function" ? (value as (p: T | null) => T | null)(prev) : value;
      dataRef.current = next;
      return next;
    });
  }, []);

  /**
   * `force` = a DEP CHANGE: the view is loading a different dataset, so a
   * first-paint spinner is correct. Live events and polls pass false: the
   * numbers on screen are still valid, so they refetch behind `refreshing`.
   * Before this split, every live event set `loading=true`, which blanked any
   * component that renders a full-page spinner on `loading` alone — the reason
   * an unrelated dashboard write looked like the page reloading.
   */
  const run = useCallback((force: boolean) => {
    if (force || dataRef.current === null) setLoading(true);
    else setRefreshing(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error(`Request timed out after ${timeoutMsRef.current / 1000}s — retrying`)), timeoutMsRef.current);
    });
    // Race the fetch against the timeout: a stalled connection can NEVER hold
    // the spinner forever — it becomes an error with data kept + retry below.
    Promise.race([fetcherRef.current(), timeout])
      .then((d) => { setData(d); setError(null); })
      .catch((e) => {
        setError(e);
        if (clearOnErrorRef.current) setData(null);
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
        setLoading(false);
        setRefreshing(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(() => run(false), [run]);

  // Initial load + reload when deps change.
  useEffect(() => {
    connect();
    run(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Subscribe to live events (once; uses refs so identity stays stable).
  useEffect(() => {
    const onLive = (ev: Event) => {
      const e = (ev as CustomEvent<LiveEvent>).detail;
      const matcher = eventsRef.current;
      const matches = Array.isArray(matcher)
        ? matcher.includes(e.type)
        : typeof matcher === "function"
        ? matcher(e)
        : true;
      if (!matches) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => refresh(), REFRESH_DEBOUNCE_MS);
    };
    bus.addEventListener("live", onLive as EventListener);
    return () => {
      bus.removeEventListener("live", onLive as EventListener);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  // Optional slow polling safety net.
  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(() => refresh(), pollMs);
    return () => clearInterval(id);
  }, [pollMs, refresh]);

  return { data, loading, refreshing, error, refresh, setData };
}

/** Imperative subscription for components that manage their own state (e.g. the
 *  WhatsApp dashboard's chat window). Receives every LiveEvent from the hub. */
export function useLiveEvent(handler: (e: LiveEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onLive = (ev: Event) => ref.current((ev as CustomEvent<LiveEvent>).detail);
    bus.addEventListener("live", onLive as EventListener);
    return () => bus.removeEventListener("live", onLive as EventListener);
  }, []);
}

/**
 * Zero-wiring live dashboard hook. Any NEW dashboard view should prefer this:
 * with no `events` filter it subscribes to EVERY live event (typed ones like
 * `estimates`/`telecalling` plus the backend's automatic `data-changed`), so a
 * new view goes live the moment its data endpoint exists — no event-name list
 * to maintain.
 *
 * High-traffic views SHOULD pass `events: [...]` to narrow the refetch: this is
 * the same hook as `useLiveQuery`, and a big payload (accounts ≈ 280 KB, master
 * data ≈ 2.6k rows) must not reload because an unrelated screen saved something.
 */
export function useLiveDashboard<T>(
  fetcher: () => Promise<T>,
  options: UseLiveQueryOptions = {},
): LiveQueryResult<T> {
  return useLiveQuery<T>(fetcher, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimistic mutations — the sales-enquiry standard, modular for EVERY dashboard.
//
// Rule: no dashboard write may wait for the network to paint. The pattern is:
//   1. patch local state instantly (via setData — surgical, no refetch),
//   2. send the server request in the background,
//   3. reconcile with server truth afterwards (refresh),
//   4. on failure resync (refresh) so the UI never sits on a lie.
//
// New automations adopt this in ~5 lines (see usage below); the live event the
// write broadcasts converges other writers automatically. Reference
// implementations: sales enquiries (`useEnquiryData.ts` — the original) and
// Accounts (`AccountsDashboard.tsx` — first adopter of this module).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transform the one row matched by `String(row[idKey]) === String(id)` inside
 * each named list field of the dashboard payload. Pure — use inside setData.
 * Payload lists stay mounted; only the touched row re-renders.
 */
export function mapRowInLists<T extends Record<string, any>>(
  prev: T | null,
  lists: (keyof T)[],
  idKey: string,
  id: string,
  fn: (row: any) => any,
): T | null {
  if (!prev) return prev;
  const next: Record<string, any> = { ...prev };
  for (const k of lists) {
    const list = (prev as any)[k];
    if (Array.isArray(list)) {
      next[k as string] = list.map((it: any) =>
        it && String(it[idKey]) === String(id) ? fn(it) : it,
      );
    }
  }
  return next as T;
}

/** Shallow-merge `patch` into the matched row in each named list. */
export function patchRowInLists<T extends Record<string, any>>(
  prev: T | null,
  lists: (keyof T)[],
  idKey: string,
  id: string,
  patch: Record<string, any>,
): T | null {
  return mapRowInLists(prev, lists, idKey, id, (row) => ({ ...row, ...patch }));
}

export interface OptimisticMutateOptions {
  /**
   * Per-record serialization key (e.g. the logId/enquiryId). Rapid taps on
   * the SAME record queue instead of racing (each body builds after the
   * previous step resolved); taps on different records run concurrently.
   * Omit for fire-and-forget writes with no ordering need.
   */
  key?: string;
  /** Set false when the caller merges server truth itself. Default true. */
  reconcile?: boolean;
}

/**
 * Shared optimistic-write driver over any `useLiveQuery`/`useLiveDashboard`
 * result. Usage (inside a dashboard component):
 *
 *   const dash = useLiveDashboard(fetchAccounts);
 *   const { mutate } = useOptimisticMutation(dash);
 *   const save = (logId, body, patch) =>
 *     mutate(
 *       (prev) => patchRowInLists(prev, ["items","senior","junior"], "logId", logId, patch),
 *       async () => {
 *         const res = await fetch(`/api/.../${logId}`, { method: "PATCH", ... });
 *         if (!res.ok) throw new Error(await res.text());
 *       },
 *       { key: logId },
 *     );
 */
export function useOptimisticMutation<T>(query: LiveQueryResult<T>) {
  const chainsRef = useRef<Record<string, Promise<unknown>>>({});
  const queryRef = useRef(query);
  queryRef.current = query;

  const mutate = useCallback(
    async (
      patch: (prev: T | null) => T | null,
      request: () => Promise<unknown>,
      opts: OptimisticMutateOptions = {},
    ): Promise<unknown> => {
      const run = async () => {
        // 1. Paint instantly — the UI never waits for the network.
        queryRef.current.setData(patch);
        try {
          const res = await request();
          // 2. Reconcile with server truth in the background (the write's
          // live broadcast converges other writers at the same time).
          if (opts.reconcile !== false) queryRef.current.refresh();
          return res;
        } catch (e) {
          // 3. Never sit on a lie — resync, then surface the error.
          queryRef.current.refresh();
          throw e;
        }
      };
      if (!opts.key) return run();
      const prev = chainsRef.current[opts.key] ?? Promise.resolve();
      const next = prev.then(run, run);
      chainsRef.current[opts.key] = next.catch(() => {});
      return next;
    },
    [],
  );

  return { mutate };
}
