"use client";
import { useState, useEffect, useCallback, useRef } from "react";

interface UseApiOptions {
  immediate?: boolean;
  pollIntervalMs?: number;
}

export function useApi<T>(fetcher: () => Promise<T>, options: UseApiOptions = {}) {
  const { immediate = true, pollIntervalMs } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(immediate);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!immediate) return;
    run();
    if (pollIntervalMs && pollIntervalMs > 0) {
      const id = setInterval(run, pollIntervalMs);
      return () => clearInterval(id);
    }
  }, [immediate, pollIntervalMs, run]);

  return { data, loading, error, refetch: run };
}
