// gateway-api.ts — the root-only gateway console API. Paths are relative to
// /api (see api/client.ts); no component calls fetch directly.

import { api } from "@/api/client";
import type { IngestedDetail, IngestedRow, InstancesPayload, InstanceView, TestResult } from "./gateway-types";

/** The Worker select names the DB columns (retryCount/errorLog/rawPayload).
 *  The console speaks one row shape, so normalise at this single boundary. */
function toRow(raw: any): IngestedRow {
  return {
    id: String(raw?.id || ""),
    source: String(raw?.source || ""),
    instanceKey: String(raw?.instanceKey || ""),
    externalEventId: String(raw?.externalEventId || ""),
    status: String(raw?.status || "pending"),
    deliveryMode: String(raw?.deliveryMode || ""),
    eventType: String(raw?.eventType || ""),
    attempts: Number(raw?.attempts ?? raw?.retryCount ?? 0),
    error: String(raw?.error ?? raw?.errorLog ?? ""),
    coreRefId: String(raw?.coreRefId || ""),
    receivedAt: String(raw?.receivedAt || ""),
    processedAt: String(raw?.processedAt || ""),
    headersJson: String(raw?.headersJson || ""),
    rawJson: String(raw?.rawJson || raw?.rawPayload || ""),
    normalizedJson: String(raw?.normalizedJson || ""),
    nextAttemptAt: raw?.nextAttemptAt ? String(raw.nextAttemptAt) : undefined,
    lockedAt: raw?.lockedAt ? String(raw.lockedAt) : undefined,
  };
}

export const fetchInstances = () => api.get<InstancesPayload>("/integrations/instances");

export const saveInstance = (body: Record<string, unknown>, id?: string) =>
  id
    ? api.patch<{ instance: InstanceView }>(`/integrations/instances/${id}`, body)
    : api.post<{ instance: InstanceView }>("/integrations/instances", body);

export const removeInstance = (id: string) =>
  api.del<{ ok: boolean }>(`/integrations/instances/${id}`);

export const testInstance = (id: string) =>
  api.post<TestResult>(`/integrations/instances/${id}/test`, {});

export async function fetchIngested(id: string): Promise<{ row: IngestedDetail }> {
  const result = await api.get<{ row: any }>(`/integrations/ingested/${id}`);
  return { row: toRow(result.row) as IngestedDetail };
}

export const replayIngested = (id: string) =>
  api.post<{ ok: boolean; coreRefId: string; error: string }>(`/integrations/ingested/${id}/replay`, {});
