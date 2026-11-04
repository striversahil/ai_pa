// crm/api.ts — dispatch-floor + Sales → Dispatch API surface.
//
// Every call is a thin wrapper: the server owns all transitions and returns
// the refreshed order, so the UI never has to guess the resulting lifecycle.
// The viewer (region + write flags) is resolved SERVER-side from the session;
// the client only echoes it back for rendering.
import { api } from "@/api/client";
import type { CrmOrder, CrmSummary, CrmViewerMeta, View } from "./types";

export interface ListResponse {
  view: View;
  orders: CrmOrder[];
  count: number;
  /** The region filter the server actually applied ('' when none). */
  region?: string;
  viewer?: CrmViewerMeta;
}

export interface SummaryResponse {
  counts: CrmSummary;
  region?: string;
  viewer?: CrmViewerMeta;
}

export interface ScheduleItemInput {
  itemId: string;
  date?: string | null;
  reason?: string | null;
}

const qs = (params: Record<string, string | undefined>) => {
  const out = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return out ? `?${out}` : "";
};

export const crmApi = {
  list: (view: View, q = "", region = "") =>
    api.get<ListResponse>(`/crm/orders${qs({ view, q, region })}`),

  summary: (region = "") => api.get<SummaryResponse>(`/crm/summary${qs({ region })}`),

  order: (id: string) => api.get<{ order: CrmOrder; viewer?: CrmViewerMeta }>(`/crm/orders/${encodeURIComponent(id)}`),

  schedule: (id: string, items: ScheduleItemInput[], soReason?: string | null) =>
    api.post<{ ok: true; lifecycle: string; order: CrmOrder }>(
      `/crm/orders/${encodeURIComponent(id)}/schedule`,
      { items, soReason: soReason ?? null },
    ),

  /** Sales agents (own region) + floor: tentative dates + delay reasons. */
  promise: (id: string, items: ScheduleItemInput[], soReason?: string | null) =>
    api.patch<{ ok: true; lifecycle: string; order: CrmOrder }>(
      `/crm/orders/${encodeURIComponent(id)}/promise`,
      { items, soReason: soReason ?? null },
    ),

  reschedule: (id: string, items: Array<{ itemId: string; date: string }>, reason: string) =>
    api.post<{ ok: true; lifecycle: string; order: CrmOrder }>(
      `/crm/orders/${encodeURIComponent(id)}/reschedule`,
      { items, reason },
    ),

  dispatch: (
    id: string,
    items: Array<{ itemId: string; qty?: number | null }>,
    proof?: { invoiceId: string | null; beforeId: string | null; afterId: string | null } | null,
  ) =>
    api.post<{ ok: true; lifecycle: string; credited: boolean; order: CrmOrder }>(
      `/crm/orders/${encodeURIComponent(id)}/dispatch`,
      { items, proof: proof ?? null },
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
