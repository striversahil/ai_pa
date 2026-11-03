// crm/hooks.ts — data + mutations for the dispatch floor.
//
// Reads are live: the backend auto-broadcasts `data-changed` for every
// mutating /api route and a typed `crm` event for sync + floor actions, so
// `useLiveDashboard` refetches without any per-view wiring. Mutations go
// through the API and then refresh — the server returns the refreshed order,
// so the panel never shows a stale lifecycle.
import { useCallback, useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { crmApi, type ListResponse, type ScheduleItemInput } from "./api";
import type { CrmOrder, CrmSummary, View } from "./types";

export function useCrmOrders(view: View, q: string) {
  return useLiveDashboard<ListResponse>(
    () => crmApi.list(view, q),
    { deps: [view, q], pollMs: 180_000 },
  );
}

export function useCrmSummary() {
  return useLiveDashboard<{ counts: CrmSummary }>(() => crmApi.summary(), { pollMs: 180_000 });
}

/** IST calendar day (YYYY-MM-DD) — the floor runs on IST, never UTC. */
export function istToday(): string {
  return new Date(Date.now() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10);
}

/** Add N days to a YYYY-MM-DD string (pure date math, no timezone drift). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface ActionState {
  busy: boolean;
  error: string | null;
}

/**
 * One mutation runner shared by all three drawers: it flips a busy flag,
 * surfaces the server's message verbatim (they're written for humans) and
 * asks the caller to refresh on success.
 */
export function useCrmAction(onDone?: (order: CrmOrder) => void) {
  const [state, setState] = useState<ActionState>({ busy: false, error: null });

  const run = useCallback(
    async (fn: () => Promise<{ order: CrmOrder }>) => {
      setState({ busy: true, error: null });
      try {
        const res = await fn();
        setState({ busy: false, error: null });
        onDone?.(res.order);
        return res.order;
      } catch (e: any) {
        setState({ busy: false, error: String(e?.message || e) });
        return null;
      }
    },
    [onDone],
  );

  const schedule = useCallback(
    (id: string, items: ScheduleItemInput[], soReason?: string | null) =>
      run(() => crmApi.schedule(id, items, soReason)),
    [run],
  );

  const reschedule = useCallback(
    (id: string, items: Array<{ itemId: string; date: string }>, reason: string) =>
      run(() => crmApi.reschedule(id, items, reason)),
    [run],
  );

  const dispatch = useCallback(
    (id: string, items: Array<{ itemId: string; qty?: number | null }>) =>
      run(() => crmApi.dispatch(id, items)),
    [run],
  );

  const confirmRemoval = useCallback(
    async (id: string) => {
      setState({ busy: true, error: null });
      try {
        await crmApi.confirmSourceDeletion(id);
        setState({ busy: false, error: null });
        return true;
      } catch (e: any) {
        setState({ busy: false, error: String(e?.message || e) });
        return false;
      }
    },
    [],
  );

  const updateAddresses = useCallback(
    (id: string, addresses: { billingAddress?: string; shippingAddress?: string }) =>
      run(() => crmApi.updateAddresses(id, addresses)),
    [run],
  );

  return { ...state, schedule, reschedule, dispatch, confirmRemoval, updateAddresses };
}
