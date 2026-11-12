// src/work/api.ts — My Work queue client (Worker-only endpoints).
// Mirror: founder-os_backend/src/worker/routes/work.ts — change together.
import { api } from "@/api/client";

export interface WorkAction {
  id: string;
  category: string;
  title: string;
  entityType: string | null;
  entityId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  priority: string;
  status: string;
  createdAt: string | null;
}

export interface WorkPayload {
  actions: WorkAction[];
  scope: string;
  projection?: { opened: number; reassigned: number; resolved: number; skipped: number; error?: string };
  sweep?: { checked: number; due: number; error?: string };
}

export const fetchMyWork = () => api.get<WorkPayload>("/work/my");
export const fetchTeamWork = () => api.get<WorkPayload>("/work/team");
export const completeAction = (id: string) => api.post<{ action: WorkAction }>(`/work/actions/${encodeURIComponent(id)}/complete`);

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  actionId: string | null;
  createdAt: string | null;
}

export interface NotificationsPayload {
  unread: number;
  notifications: AppNotification[];
}

export const fetchNotifications = () => api.get<NotificationsPayload>("/notifications");
export const markNotificationRead = (id: string) => api.post<{ ok: boolean }>(`/notifications/${encodeURIComponent(id)}/read`);

// ── Phase 7c/7d: lead ledger reads + gate (mirror: worker/routes/leads.ts) ──
export interface LeadRow {
  id: string;
  status: string;
  outcome: string;
  customerName: string;
  clientCompany: string;
  contactName: string;
  contactPhone: string;
  location: string;
  region: string;
  sourceName: string;
  sourceRaw: string;
  productText: string;
  quotedRateAmount: number | null;
  expectedRateAmount: number | null;
  disqualifyReason: string;
  qualifiedBy: string;
  qualifiedAt: string;
  enquiryId: string;
  estimateId: string;
  estNumber: string;
  occurredAt: string;
  captureKind: string;
}

export const fetchLeadsMe = () => api.get<{ canQualify: boolean; regions: string[] | null }>("/leads/me");
export const fetchUnqualifiedLeads = () => api.get<{ leads: LeadRow[]; scope: string }>("/leads/unqualified");
export const fetchLeadLosses = (params?: { source?: string; from?: string; to?: string }) => {
  const q = new URLSearchParams();
  if (params?.source) q.set("source", params.source);
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  const s = q.toString();
  return api.get<{ leads: LeadRow[]; count: number; quotedTotal: number; scope: string }>(`/leads/losses${s ? `?${s}` : ""}`);
};
export const qualifyLead = (id: string, note?: string) =>
  api.put<{ ok: boolean }>(`/leads/${encodeURIComponent(id)}/qualify`, { note: note ?? "" });
export const dropLead = (id: string, reason: string, detail?: string) =>
  api.put<{ ok: boolean }>(`/leads/${encodeURIComponent(id)}/drop`, { reason, detail: detail ?? "" });
export const LEAD_DROP_REASONS = [
  "no_response", "wrong_number", "price_too_high", "no_budget", "not_genuine",
  "out_of_scope", "duplicate", "competitor_won", "client_cancelled", "other",
] as const;
