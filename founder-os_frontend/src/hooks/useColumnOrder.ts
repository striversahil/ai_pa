"use client";

import { useCallback, useEffect, useState } from "react";

/** Persistent, self-healing column order for tables (survives added/removed columns). */
export function useColumnOrder(storageKey: string, defaults: readonly string[]) {
  const defaultKey = defaults.join("|");
  const [order, setOrder] = useState<string[]>(() => [...defaults]);

  useEffect(() => {
    const fallback = defaultKey ? defaultKey.split("|") : [];
    let next = fallback;
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) {
        const valid = new Set(fallback);
        const cleaned = parsed.filter((key): key is string => typeof key === "string" && valid.has(key));
        for (const key of fallback) if (!cleaned.includes(key)) cleaned.push(key);
        next = cleaned;
      }
    } catch {}
    setOrder(next);
  }, [storageKey, defaultKey]);

  const move = useCallback((from: string, to: string) => {
    setOrder((prev) => {
      const a = prev.indexOf(from);
      const b = prev.indexOf(to);
      if (a < 0 || b < 0 || a === b) return prev;
      const next = [...prev];
      const [moved] = next.splice(a, 1);
      next.splice(b, 0, moved);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [storageKey]);

  return { order, move };
}
