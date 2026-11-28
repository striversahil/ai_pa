// gateway-api.ts — Settings → third-party providers + the ingested log.
// Paths are relative to /api (see api/client.ts).

import { api } from "@/api/client";
import type { InstancesPayload, InstanceView } from "./gateway-types";

export const fetchInstances = () => api.get<InstancesPayload>("/integrations/instances");

export const saveInstance = (body: Record<string, unknown>, id?: string) =>
  id
    ? api.patch<{ instance: InstanceView }>(`/integrations/instances/${id}`, body)
    : api.post<{ instance: InstanceView }>("/integrations/instances", body);

export const removeInstance = (id: string) =>
  api.del<{ ok: boolean }>(`/integrations/instances/${id}`);

export const testInstance = (id: string) =>
  api.post<{ ok: boolean; detail?: string }>(`/integrations/instances/${id}/test`, {});

export const replayIngested = (id: string) =>
  api.post<{ ok: boolean; coreRefId: string; error: string }>(`/integrations/ingested/${id}/replay`, {});
