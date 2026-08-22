import { useEffect, useRef } from "react";

export type LiveEvent = { type: string; [key: string]: unknown };

const PING_MS = 60_000;

// Subscribes to the worker's EventHub WebSocket (/api/events) and invokes
// `onEvent` for every broadcast data-change (e.g. { type: "estimates" },
// { type: "neodove" }, { type: "baseline" }, { type: "automation", slug }).
// Auto-reconnects with backoff; periodic pings keep NAT/proxies from idling
// the socket out. Components keep their own slow polling as a safety net.
export function useLiveEvents(onEvent: (event: LiveEvent) => void) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const pinger = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send("ping"); } catch {}
      }
    }, PING_MS);

    const connect = () => {
      if (stopped || typeof WebSocket === "undefined") return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      try {
        ws = new WebSocket(`${proto}//${window.location.host}/api/events`);
      } catch {
        scheduleRetry();
        return;
      }
      ws.onopen = () => { attempt = 0; };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as LiveEvent;
          if (data && typeof data.type === "string" && data.type !== "hello") {
            handlerRef.current(data);
          }
        } catch {}
      };
      ws.onclose = () => {
        ws = null;
        scheduleRetry();
      };
      ws.onerror = () => {
        try { ws?.close(); } catch {}
      };
    };

    const scheduleRetry = () => {
      if (stopped) return;
      attempt += 1;
      retryTimer = setTimeout(connect, Math.min(30_000, 1500 * attempt));
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(pinger);
      if (ws) {
        ws.onclose = null;
        try { ws.close(); } catch {}
      }
    };
  }, []);
}

// Convenience wrapper: debounced refetch whenever a live event passes the
// predicate (e.g. automation slug or data type matches this dashboard).
export function useLiveRefresh(
  shouldRefresh: (event: LiveEvent) => boolean,
  refresh: () => void,
  delayMs = 2000,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fns = useRef({ shouldRefresh, refresh });
  fns.current = { shouldRefresh, refresh };

  useLiveEvents((event) => {
    if (!fns.current.shouldRefresh(event)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fns.current.refresh(), delayMs);
  });

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
}
