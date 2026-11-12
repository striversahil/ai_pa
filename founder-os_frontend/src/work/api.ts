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
