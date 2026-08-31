"use client";
import { useState, useEffect, useCallback } from "react";

export interface HashRoute {
  view: string;
  sub: string | null;
}

/** Read the current view/sub from the URL path (/automations, /chat…). */
function parsePath(): HashRoute {
  if (typeof window === "undefined") return { view: "automations", sub: null };
  const raw = window.location.pathname.replace(/^\/+|\/+$/g, "");
  const [first, ...rest] = raw.split("/").filter(Boolean);
  if (!first) return { view: "automations", sub: null };
  const sub = rest.length ? decodeURIComponent(rest.join("/")) : null;
  return { view: first, sub };
}

/**
 * Clean-path router (History API) — replaces the legacy `#/hash` routes.
 * `navigate()` still accepts legacy "/x" strings and normalizes them to "/x",
 * so existing call sites keep working while URLs stay professional.
 */
export function useHashRoute(): { route: HashRoute; navigate: (path: string) => void } {
  const [route, setRoute] = useState<HashRoute>(parsePath);

  useEffect(() => {
    const onPop = () => setRoute(parsePath());
    window.addEventListener("popstate", onPop);
    // Root path → canonical /automations (no reload).
    if (window.location.pathname === "/" && !window.location.hash) {
      window.history.replaceState(null, "", "/automations");
      setRoute({ view: "automations", sub: null });
    }
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((path: string) => {
    const clean = path.startsWith("#") ? path.slice(1) : path;
    const target = clean.startsWith("/") ? clean : `/${clean}`;
    if (window.location.pathname + window.location.search === target) return;
    window.history.pushState(null, "", target);
    setRoute(parsePath());
  }, []);

  return { route, navigate };
}
