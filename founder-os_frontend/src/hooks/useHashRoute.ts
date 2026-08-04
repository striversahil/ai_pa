"use client";
import { useState, useEffect, useCallback } from "react";

export interface HashRoute {
  view: string;
  sub: string | null;
}

function parseHash(): HashRoute {
  if (typeof window === "undefined") return { view: "automations", sub: null };
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [first, ...rest] = raw.split("/").filter(Boolean);
  if (!first) return { view: "automations", sub: null };
  const sub = rest.length ? decodeURIComponent(rest.join("/")) : null;
  return { view: first, sub };
}

export function useHashRoute(): { route: HashRoute; navigate: (path: string) => void } {
  const [route, setRoute] = useState<HashRoute>(parseHash);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHashChange);
    if (!window.location.hash) {
      window.location.hash = "#/automations";
    }
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((path: string) => {
    if (window.location.hash === `#${path}`) return;
    window.location.hash = path;
  }, []);

  return { route, navigate };
}
