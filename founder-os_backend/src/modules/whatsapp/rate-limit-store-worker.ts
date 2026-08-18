import { logger } from '../../shared/logger';

/**
 * Worker-safe rate-limit store: identical API to the fs-backed store, but keeps
 * state in memory (Durable Object persistence is out of scope for v1). On a
 * warm restart the hour cap is recomputed by OutboundService, so throttling
 * still re-establishes quickly after an outage.
 */

export interface RateLimitState {
  accountTimestamps: number[];
  hourLimit: number;
  chatTimestamps: Record<string, number[]>;
}

let cachedState: RateLimitState | null = null;

function defaultState(): RateLimitState {
  return { accountTimestamps: [], hourLimit: 0, chatTimestamps: {} };
}

export function getRateLimitState(): RateLimitState {
  if (!cachedState) cachedState = defaultState();
  return cachedState;
}

export function persistRateLimitState(): void {
  // In-memory only — nothing to flush on the worker.
  if (!cachedState) cachedState = defaultState();
}