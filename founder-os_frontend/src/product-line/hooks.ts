// hooks.ts — Product Line data hooks (components stay render-only).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api/client";
import { useLiveQuery } from "@/hooks/useLiveData";
import { productLineApi } from "./api";
import { EMPTY_FILTERS, RATES_PAGE_DEFAULT, toQuery, type RateFilters } from "./filters";
import type { LiveCatalog, Paged, Payload, PromptPayload, RateBatchRow, RateRow } from "./types";

/** Workspace payload (products + guide + vendors + totals), live on `product-line`. */
export function usePayload() {
  return useLiveQuery<Payload>(() => productLineApi.payload(), { events: ["product-line"] });
}

/** The live catalogue — typed specs the editors and the KYP export use. */
export function useCatalog() {
  const q = useLiveQuery<LiveCatalog>(() => productLineApi.catalog(), { events: ["product-line"] });
  const byId = useMemo(() => {
    const map = new Map<string, LiveCatalog["products"][number]>();
    for (const p of q.data?.products ?? []) map.set(p.id, p);
    return map;
  }, [q.data]);
  const byKey = useMemo(() => {
    const map = new Map<string, LiveCatalog["products"][number]>();
    for (const p of q.data?.products ?? []) map.set(p.key, p);
    return map;
  }, [q.data]);
  return { ...q, products: q.data?.products ?? [], categories: q.data?.categories ?? [], byId, byKey };
}

export interface UseRatesResult {
  rows: RateRow[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
  loading: boolean;
  refreshing: boolean;
  error: unknown;
  setPage: (n: number) => void;
  setLimit: (n: number) => void;
  /** What the builder currently shows (never queried until `run()`). */
  draft: RateFilters;
  patch: (patch: Partial<RateFilters>) => void;
  /** The filters the visible page was fetched with. */
  applied: RateFilters;
  /** "Run query" — commit the draft and go back to page 1. */
  run: () => void;
  /** True while the builder differs from what is displayed. */
  dirty: boolean;
  resetFilters: () => void;
  refresh: () => void;
}

/**
 * The rates sheet: one query at a time, driven by an explicit "Run query".
 * The filter builder edits `draft`; nothing is fetched until it is run, so a
 * dozen range fields cost one request instead of a dozen.
 */
export function useRates(initial: Partial<RateFilters> = {}): UseRatesResult {
  const base = useMemo(() => ({ ...EMPTY_FILTERS, ...initial }), [initial]);
  const [draft, setDraft] = useState<RateFilters>(base);
  const [applied, setApplied] = useState<RateFilters>(base);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(RATES_PAGE_DEFAULT);
  const quietUntil = useRef(0);

  const query = toQuery(applied, page, limit);
  const result = useLiveQuery<Paged<RateRow> | null>(
    () => api.get<Paged<RateRow>>(`/product-line/rates?${query}`),
    { deps: [query] },
  );

  const patch = useCallback((p: Partial<RateFilters>) => {
    setDraft((d) => ({ ...d, ...p }));
  }, []);

  const run = useCallback(() => {
    setApplied((a) => (JSON.stringify(a) === JSON.stringify(draft) ? { ...draft } : draft));
    setPage(1);
  }, [draft]);

  const resetFilters = useCallback(() => {
    setDraft(base);
    setApplied(base);
    setPage(1);
  }, [base]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  return {
    rows: result.data?.rows ?? [],
    total: result.data?.total ?? 0,
    page: result.data?.page ?? page,
    totalPages: result.data?.totalPages ?? 1,
    limit: result.data?.limit ?? limit,
    loading: result.loading,
    refreshing: result.refreshing,
    error: result.error,
    setPage,
    setLimit,
    draft,
    patch,
    applied,
    run,
    dirty,
    resetFilters,
    refresh: useCallback(() => {
      quietUntil.current = Date.now() + 1500;
      setApplied((a) => ({ ...a }));
    }, []),
  };
}

/** One quote + its product's spec contract (the drawer). */
export function useRateDetail(id: string | null) {
  return useLiveQuery(
    () => (id ? productLineApi.rateDetail(id) : Promise.resolve(null)),
    { events: ["product-line"], deps: [id] },
  );
}

/** The saved rate-intake prompt (template + rendered vendor block). */
export function usePrompt() {
  const [data, setData] = useState<PromptPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoading(true);
    return productLineApi
      .prompt()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refresh: load, setData };
}

/** The paste log — live on `product-line` so a new import appears at once. */
export function useBatches() {
  const q = useLiveQuery<{ batches: RateBatchRow[] }>(() => productLineApi.batches(), { events: ["product-line"] });
  return { batches: q.data?.batches ?? [], loading: q.loading, refresh: q.refresh };
}
