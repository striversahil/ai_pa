// api.ts — the integrations console endpoints (root-only server side).
import { api } from "@/api/client";
import type { CatalogEntry, CustomConnector, DeliveryRow, EventDetail, IntegrationsPayload, IntegrationEventRow, IntegrationSource, MappingSpec } from "./types";
import type { Paged } from "@/lib/paging";

export const fetchIntegrations = () => api.get<IntegrationsPayload>("/integrations");

export const createSource = (body: {
  connectorKey?: string;
  connectorId?: string;
  name?: string;
  config?: Record<string, unknown>;
  mapping?: MappingSpec;
}) => api.post<{ ok: boolean; source: IntegrationSource; token: string; signingSecret: string }>("/integrations", body);

export const updateSource = (id: string, body: Record<string, unknown>) =>
  api.patch<{ ok: boolean; source: IntegrationSource }>(`/integrations/${id}`, body);

export const removeSource = (id: string, purge: boolean) =>
  api.del<{ ok: boolean; purged: boolean }>(`/integrations/${id}${purge ? "?purge=1" : ""}`);

export const rotateSource = (id: string) =>
  api.post<{ ok: boolean; token: string; webhookUrl: string }>(`/integrations/${id}/rotate`);

export const previewMapping = (body: { payload: string; mapping?: MappingSpec; connectorKey?: string }) =>
  api.post<{ ok: boolean; events: Array<Record<string, unknown>>; warnings: string[] }>("/integrations/preview", body);

export const createConnector = (body: { name: string; icon?: string; mapping?: MappingSpec; sample?: string }) =>
  api.post<{ ok: boolean; connector: CustomConnector }>("/integrations/connectors", body);

export const updateConnector = (id: string, body: Record<string, unknown>) =>
  api.patch<{ ok: boolean; connector: CustomConnector }>(`/integrations/connectors/${id}`, body);

export const removeConnector = (id: string) => api.del<{ ok: boolean }>(`/integrations/connectors/${id}`);

export const fetchEvent = (id: string) =>
  api.get<{ ok: boolean; event: EventDetail; source: IntegrationSource | null }>(`/integrations/events/${id}`);

export const replayEvent = (sourceId: string, eventId: string) =>
  api.post<{ ok: boolean; event: IntegrationEventRow }>(`/integrations/${sourceId}/events/${eventId}/replay`);

export const fetchDeliveries = (sourceId: string, page: number, limit = 20) =>
  api.get<Paged<DeliveryRow>>(`/integrations/${sourceId}/deliveries?page=${page}&limit=${limit}`);

export type { CatalogEntry, CustomConnector, DeliveryRow, EventDetail, IntegrationEventRow, IntegrationSource, MappingSpec };