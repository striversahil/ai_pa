"use client";

// Pinned workspaces (localStorage). Migrates the legacy "pinned_automations"
// key once, mapping legacy slugs to their successors.
import { useEffect } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { canonicalNavSlug } from "./aliases";

const KEY = "pinned_workspaces";
const LEGACY_KEY = "pinned_automations";

export function usePinnedWorkspaces(): {
  pinned: string[];
  isPinned: (slug: string) => boolean;
  toggle: (slug: string) => void;
  setPinned: (slugs: string[]) => void;
} {
  const [raw, setRaw] = useLocalStorage<string[]>(KEY, []);

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) !== null) return;
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (!legacy) return;
      const slugs = JSON.parse(legacy);
      if (Array.isArray(slugs)) setRaw([...new Set(slugs.map((s) => canonicalNavSlug(String(s))))]);
    } catch { /* ignore corrupt storage */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pinned = [...new Set(raw.map(canonicalNavSlug))];
  return {
    pinned,
    isPinned: (slug) => pinned.includes(canonicalNavSlug(slug)),
    toggle: (slug) => {
      const s = canonicalNavSlug(slug);
      setRaw(pinned.includes(s) ? pinned.filter((x) => x !== s) : [...pinned, s]);
    },
    setPinned: setRaw,
  };
}
