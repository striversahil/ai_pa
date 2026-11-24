// ─────────────────────────────────────────────────────────────────────────────
// notifications/api.ts — every fetch the notification surfaces make.
//
// Components never call fetch directly (house rule): they use the provider hook
// or the console hook, which call these functions.
// ─────────────────────────────────────────────────────────────────────────────
import { api } from "@/api/client";
import type {
  NotificationConsolePayload,
  NotificationsPayload,
  NotificationRule,
  NotificationRunResult,
  NotificationSettings,
  NotificationLevelDef,
  NotificationOptions,
  NotificationSchema,
} from "./types";

const PANEL_LIMIT = 200;

export const fetchNotifications = (employeeKey?: string) =>
  api.get<NotificationsPayload>(
    `/notifications?status=all&limit=${PANEL_LIMIT}${employeeKey ? `&employeeKey=${encodeURIComponent(employeeKey)}` : ""}`,
  );

export const markNotificationRead = (id: string) => api.post<{ ok: boolean }>(`/notifications/${id}/read`);
export const markAllNotificationsRead = () => api.post<{ ok: boolean; read: number }>(`/notifications/read-all`);

export const fetchNotificationConsole = () => api.get<NotificationConsolePayload>("/notification-rules");
export const fetchNotificationOptions = () => api.get<NotificationOptions>("/notification-options");

export const saveNotificationRule = (key: string, rule: Partial<NotificationRule>) =>
  api.put<{ rule: NotificationRule }>(`/notification-rules/${encodeURIComponent(key)}`, rule);

export const deleteNotificationRule = (key: string) =>
  api.del<{ ok: boolean; removed: number }>(`/notification-rules/${encodeURIComponent(key)}`);

export interface TestRuleResponse {
  result: NotificationRunResult;
  tokens: string[];
  nextDueAt: string | null;
  /** How far back the dry run looked (0 = the rule's own window). */
  lookbackHours?: number;
}

export const testNotificationRule = (key: string, rule?: Partial<NotificationRule>, lookbackHours = 0) =>
  api.post<TestRuleResponse>(
    `/notification-rules/${encodeURIComponent(key)}/test`,
    { ...(rule ? { rule } : {}), ...(lookbackHours > 0 ? { lookbackHours } : {}) },
  );

export const runNotificationRule = (key: string) =>
  api.post<{ result: NotificationRunResult }>(`/notification-rules/${encodeURIComponent(key)}/run`);

export const saveNotificationSettings = (body: { levels?: NotificationLevelDef[]; settings?: NotificationSettings }) =>
  api.put<{ levels: NotificationLevelDef[]; settings: NotificationSettings }>("/notification-settings", body);

/** AI authoring: the saved prompt + the live D1 schema (both root/admin). */
export const fetchNotificationPrompt = () =>
  api.get<{ text: string; defaultPrompt: string }>("/notification-prompt");

export const saveNotificationPrompt = (text: string) =>
  api.put<{ text: string; defaultPrompt: string }>("/notification-prompt", { text });

export const fetchNotificationSchema = () =>
  api.get<NotificationSchema>("/notification-schema");
