// crm/api.ts — dispatch-floor API surface.
//
// Every call is a thin wrapper: the server owns all transitions and returns
// the refreshed order, so the UI never has to guess the resulting lifecycle.
import { api } from "@/api/client";
import type { CrmOrder, CrmSummary, View } from "./types";

export interface ListResponse {
  view: View;
  orders: CrmOrder[];
  count: number;
}

export interface ScheduleItemInput {
  itemId: string;
  date?: string | null;
  reason?: string | null;
}

export const crmApi = {
  list: (view: View, q = "") =>
    api.get<ListResponse>(`/crm/orders?view=${encodeURIComponent(view)}&q=${encodeURIComponent(q)}`),

  summary: () => api.get<{ counts: CrmSummary }>("/crm/summary"),

  order: (id: string) => api.get<{ order: CrmOrder }>(`/crm/orders/${encodeURIComponent(id)}`),

  schedule: (id: string, items: ScheduleItemInput[], soReason?: string | null) =>
    api.post<{ ok: true; lifecycle: string; order: CrmOrder }>(
      `/crm/orders/${encodeURIComponent(id)}/schedule`,
      { items, soReason: soReason ?? null },
    ),

  reschedule: (id: string, items: Array<{ itemId: string; date: string }>, reason: string) =>
    api.post<{ ok: true; lifecycle: string; order: CrmOrder }>(
      `/crm/orders/${encodeURIComponent(id)}/reschedule`,
      { items, reason },
    ),

  dispatch: (id: string, items: Array<{ itemId: string; qty?: number | null }>) =>
    api.post<{ ok: true; lifecycle: string; credited: boolean; order: CrmOrder }>(
      `/crm/orders/${encodeURIComponent(id)}/dispatch`,
      { items },
    ),

  confirmSourceDeletion: (id: string) =>
    api.post<{ ok: true; soNumber: string; removed: boolean }>(
      `/crm/orders/${encodeURIComponent(id)}/confirm-source-deletion`,
    ),

  updateAddresses: (id: string, addresses: { billingAddress?: string; shippingAddress?: string }) =>
    api.put<{ ok: true; order: CrmOrder }>(
      `/crm/orders/${encodeURIComponent(id)}/addresses`,
      addresses,
    ),
};
