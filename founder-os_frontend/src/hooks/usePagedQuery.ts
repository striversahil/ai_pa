"use client";

// usePagedQuery — the ONE data hook for a paged list screen.
// Founder standard (2026-11-21): page numbers, 50 rows, search over the whole
// table on the server, COUNT totals, and live writes show a "N new changes"
// banner instead of reloading under the user. Pair with <Pager> and
// <ChangesBanner> from @/components/ui.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { useLiveEvent, useLiveQuery, type LiveEvent } from "@/hooks/useLiveData";
import { PAGE_SIZE, pagedUrl, type Paged } from "@/lib/paging";

const SEARCH_DEBOUNCE_MS = 300;
/** Our own save broadcasts a live event too; don't count it as "new". */
const SELF_WRITE_QUIET_MS = 4000;

export interface UsePagedQueryOptions {
  /** Live event types that mean this list changed (counted for the banner). */
  events: string[];
  /** Extra server filters; changing one jumps back to page 1. */
  filters?: Record<string, string | number | undefined | null>;
  limit?: number;
  /** false = don't fetch yet (e.g. tab not open). */
  enabled?: boolean;
}

/** What a paged list component receives as a prop. */
export type PagedQuery<T> = ReturnType<typeof usePagedQuery<T>>;

export function usePagedQuery<T>(base: string, opts: UsePagedQueryOptions) {
  const { events, filters = {}, limit = PAGE_SIZE, enabled = true } = opts;
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [changes, setChanges] = useState(0);
  const quietUntil = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // New search or filter → back to page 1 (derived during render, no effect).
  const resetKey = `${debouncedQ}|${JSON.stringify(filters)}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setPage(1);
  }

  const url = pagedUrl(base, { ...filters, page, limit, q: debouncedQ });
  const query = useLiveQuery<Paged<T> | null>(
    () => (enabled ? api.get<Paged<T>>(url) : Promise.resolve(null)),
    { events: () => false, deps: [url, enabled] },
  );

  useLiveEvent((e: LiveEvent) => {
    if (!enabled || !events.includes(e.type)) return;
    if (Date.now() < quietUntil.current) return;
    setChanges((n) => n + 1);
  });

  /** Reload the current page now (after our own save, or from the banner). */
  const refresh = useCallback(() => {
    quietUntil.current = Date.now() + SELF_WRITE_QUIET_MS;
    setChanges(0);
    query.refresh();
  }, [query]);

  const data = query.data;
  return {
    rows: data?.rows ?? [],
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 1,
    page,
    limit,
    setPage,
    q,
    setQ,
    loading: query.loading,
    refreshing: query.refreshing,
    error: query.error,
    hasData: data != null,
    changes,
    refresh,
  };
}
