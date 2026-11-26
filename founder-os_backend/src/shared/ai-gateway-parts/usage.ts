// Usage KV + AI-cache hash helpers (split out of pure.ts to keep it under the
// 400-line ratchet; pure.ts re-exports them for existing imports).
export const GATEWAY_USAGE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const GATEWAY_USAGE_PREFIX = 'ai:usage:';

export function gatewayUsageKey(date = new Date()): string {
  return `${GATEWAY_USAGE_PREFIX}${date.toISOString().slice(0, 10)}`;
}

// Stable hash for AI cache keys (djb2)
export function hashAI(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
