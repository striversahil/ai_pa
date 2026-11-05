"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

/** Row identity: main views and dashboards share one flat order. */
export function viewKey(view: string): string {
  return `view:${view}`;
}

export function dashKey(slug: string): string {
  return `dash:${slug}`;
}

export function orderStorageKey(email: string | null | undefined): string | null {
  const id = (email ?? "").trim().toLowerCase();
  if (!id) return null;
  return `sidebar-order:v1:${id}`;
}

export function floatStorageKey(email: string | null | undefined): string | null {
  const id = (email ?? "").trim().toLowerCase();
  if (!id) return null;
  return `sidebar-float:v1:${id}`;
}

function loadJSON<T>(key: string | null, fallback: T): T {
  if (!key || typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string | null, value: unknown): void {
  if (!key || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — order just won't persist */
  }
}

/** Merge a stored key order with the live default list.
 *  Stored keys that no longer exist drop out; brand-new grants append. */
export function applyOrder<T>(items: T[], keyOf: (item: T) => string, stored: string[]): T[] {
  const byKey = new Map(items.map((item) => [keyOf(item), item]));
  const ordered: T[] = [];
  for (const key of stored) {
    const item = byKey.get(key);
    if (item) {
      ordered.push(item);
      byKey.delete(key);
    }
  }
  for (const item of items) {
    if (byKey.has(keyOf(item))) ordered.push(item);
  }
  return ordered;
}

/** Per-user sidebar order (this browser only). */
export function useSidebarOrder(storageKey: string | null, defaultKeys: string[]): {
  order: string[];
  move: (key: string, toIndex: number) => void;
  reset: () => void;
} {
  const fingerprint = defaultKeys.join("|");
  const [stored, setStored] = useState<string[]>(() => loadJSON<string[]>(storageKey, []));

  useEffect(() => {
    setStored(loadJSON<string[]>(storageKey, []));
  }, [storageKey]);

  const order = useMemo(() => {
    const keys = fingerprint.split("|").filter(Boolean);
    const known = new Set(keys);
    const kept = stored.filter((k) => known.has(k));
    const missing = keys.filter((k) => !kept.includes(k));
    return [...kept, ...missing];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, fingerprint]);

  const move = useCallback(
    (key: string, toIndex: number) => {
      const keys = fingerprint.split("|").filter(Boolean);
      setStored((prev) => {
        const known = new Set(keys);
        const base = [...prev.filter((k) => known.has(k)), ...keys.filter((k) => !prev.includes(k))];
        const from = base.indexOf(key);
        if (from < 0) return prev;
        const next = [...base];
        next.splice(from, 1);
        next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, key);
        saveJSON(storageKey, next);
        return next;
      });
    },
    [fingerprint, storageKey],
  );

  const reset = useCallback(() => {
    const keys = fingerprint.split("|").filter(Boolean);
    setStored(keys);
    saveJSON(storageKey, keys);
  }, [fingerprint, storageKey]);

  return { order, move, reset };
}

export interface FloatState {
  floating: boolean;
  x: number;
  y: number;
}

const PANEL_W = 260;

function clampPos(x: number, y: number): { x: number; y: number } {
  if (typeof window === "undefined") return { x, y };
  return {
    x: Math.max(8, Math.min(Math.max(8, window.innerWidth - PANEL_W - 8), x)),
    y: Math.max(8, Math.min(Math.max(8, window.innerHeight - 120), y)),
  };
}

/** Per-user floating-panel state (this browser only). */
export function useSidebarFloat(storageKey: string | null): {
  floating: boolean;
  x: number;
  y: number;
  undock: () => void;
  dock: () => void;
  setPos: (x: number, y: number) => void;
  commitPos: () => void;
} {
  const [state, setState] = useState<FloatState>({ floating: false, x: 24, y: 24 });

  useEffect(() => {
    const loaded = loadJSON<FloatState | null>(storageKey, null);
    if (loaded && typeof loaded === "object") {
      const p = clampPos(Number(loaded.x) || 24, Number(loaded.y) || 24);
      setState({ floating: !!loaded.floating, x: p.x, y: p.y });
    } else {
      setState({ floating: false, x: 24, y: 24 });
    }
  }, [storageKey]);

  const undock = useCallback(() => {
    setState((prev) => {
      const p = clampPos(prev.x, prev.y);
      const next = { floating: true, x: p.x, y: p.y };
      saveJSON(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const dock = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, floating: false };
      saveJSON(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const setPos = useCallback((x: number, y: number) => {
    const p = clampPos(x, y);
    setState((prev) => ({ ...prev, ...p }));
  }, []);

  const commitPos = useCallback(() => {
    setState((prev) => {
      saveJSON(storageKey, prev);
      return prev;
    });
  }, [storageKey]);

  return { floating: state.floating, x: state.x, y: state.y, undock, dock, setPos, commitPos };
}
