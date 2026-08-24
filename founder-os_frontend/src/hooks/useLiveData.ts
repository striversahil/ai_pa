import { useCallback, useEffect, useRef, useState } from "react";

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

// ── Module-level singleton: one socket + one event bus for the whole app ──
const bus = new EventTarget();
let socket: WebSocket | null = null;
let attempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;

function connect() {
  if (typeof WebSocket === "undefined") return;
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
}

export interface LiveQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  refresh: () => void;
}

export function useLiveQuery<T>(
  fetcher: () => Promise<T>,
  options: UseLiveQueryOptions = {},
): LiveQueryResult<T> {
  const { events, deps = [], pollMs } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetcherRef
      .current()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => { setError(e); })
      .finally(() => { setLoading(false); });
  }, []);

  // Initial load + reload when deps change.
  useEffect(() => {
    connect();
    refresh();
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

  return { data, loading, error, refresh };
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
