/**
 * Payment Tracker cache namespace. Bumped whenever the dashboard payload shape
 * or its computation changes (v5 = + customer-level region).
 */
import { cacheDelPrefix } from '../../shared/cache';

export const PAYMENT_CACHE_PREFIX = 'payment-tracker:data:v5:';
export const PAYMENT_TTL_MS = 5 * 60 * 1000;

export async function invalidatePaymentCache(): Promise<void> {
  await cacheDelPrefix(PAYMENT_CACHE_PREFIX);
}
