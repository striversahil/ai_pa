// gateway-pure.ts — sync-only helpers for the integration console. Mirrors the
// Worker validation conditions (manifest.ts#conditionMet/typeError) so the
// drawer can explain a missing field before the server rejects the save.

import type {
  InstanceView,
  ProviderField,
  ProviderManifest,
  SourceStat,
} from "./gateway-types";

export interface Draft {
  instanceKey: string;
  label: string;
  baseUrl: string;
  deliveryMode: "realtime" | "batch";
  enabled: boolean;
  isDefault: boolean;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}

export function categoryLabel(categories: Record<string, string>, key: string): string {
  return categories[key] || key.replace(/_/g, " ");
}

export function directionLabel(direction: string | undefined): string {
  if (direction === "both") return "Two-way";
  if (direction === "inbound") return "Inbound";
  if (direction === "outbound") return "Outbound";
  return "Connector";
}

export function conditionMatches(
  condition: ProviderField["requiredWhen"],
  config: Record<string, unknown>,
  secrets: Record<string, string>,
): boolean {
  if (!condition) return true;
  const value = config[condition.field] ?? secrets[condition.field];
  if (condition.in) return condition.in.map(String).includes(String(value ?? ""));
  if (condition.includes !== undefined) return String(value ?? "").includes(condition.includes);
  if (condition.equals !== undefined) return String(value ?? "") === String(condition.equals);
  if (condition.truthy !== undefined) return condition.truthy ? Boolean(value) : !value;
  return value !== undefined && value !== null && value !== "";
}

export function fieldRequired(
  field: ProviderField,
  config: Record<string, unknown>,
  secrets: Record<string, string>,
): boolean {
  // Mirrors backend manifest.ts#validateInstancePayload: `required` always wins,
  // otherwise `requiredWhen` makes the field required only while it matches.
  return !!field.required || conditionMatches(field.requiredWhen, config, secrets);
}

export function fieldVisible(
  field: ProviderField,
  config: Record<string, unknown>,
  secrets: Record<string, string>,
): boolean {
  return fieldRequired(field, config, secrets);
}

export function initialDraft(manifest: ProviderManifest, instance?: InstanceView | null): Draft {
  const config: Record<string, unknown> = {};
  for (const field of manifest.configFields || []) {
    const current = instance?.config?.[field.key];
    config[field.key] = current !== undefined && current !== null
      ? current
      : field.defaultValue !== undefined ? field.defaultValue : "";
  }
  return {
    instanceKey: instance?.instanceKey || "default",
    label: instance?.label || "",
    baseUrl: instance?.baseUrl || String(manifest.defaultBaseUrl || ""),
    deliveryMode: instance?.deliveryMode === "realtime" || (!instance && manifest.defaultDeliveryMode === "realtime")
      ? "realtime"
      : "batch",
    enabled: instance ? instance.enabled : true,
    isDefault: instance ? instance.isDefault : true,
    config,
    secrets: {},
  };
}

function typeError(field: ProviderField, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (field.type === "number" && Number.isNaN(Number(value))) return `${field.label} must be a number`;
  if (field.type === "boolean" && typeof value !== "boolean" && !["true", "false", "0", "1"].includes(String(value))) {
    return `${field.label} must be true or false`;
  }
  if (field.type === "json") {
    try { JSON.parse(typeof value === "string" ? value : JSON.stringify(value)); }
    catch { return `${field.label} must be valid JSON`; }
  }
  return null;
}

export function validateDraft(manifest: ProviderManifest, draft: Draft): string[] {
  const errors: string[] = [];
  const key = draft.instanceKey.trim().toLowerCase();
  if (!key) errors.push("Instance key is required");
  else if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(key)) errors.push("Use lowercase letters, numbers, dashes or underscores (max 40)");
  if (draft.baseUrl.trim() && !/^https?:\/\//i.test(draft.baseUrl.trim())) errors.push("Base URL must start with http:// or https://");
  for (const field of manifest.configFields || []) {
    if (!fieldVisible(field, draft.config, draft.secrets)) continue;
    const value = draft.config[field.key];
    if (fieldRequired(field, draft.config, draft.secrets) && (value === undefined || value === null || String(value).trim() === "")) {
      errors.push(`${field.label} is required`);
      continue;
    }
    const bad = typeError(field, value);
    if (bad) errors.push(bad);
  }
  for (const field of manifest.secretFields || []) {
    if (!fieldVisible(field, draft.config, draft.secrets)) continue;
    if (fieldRequired(field, draft.config, draft.secrets) && !String(draft.secrets[field.key] || "").trim()) {
      errors.push(`${field.label} is required`);
    }
  }
  return errors;
}

export function hasStoredSecret(instance: InstanceView | null | undefined, field: ProviderField): boolean {
  return !!instance && (instance.secretKeys || []).includes(field.key);
}

export function validateWithStored(
  manifest: ProviderManifest,
  draft: Draft,
  instance?: InstanceView | null,
): string[] {
  const errors = validateDraft(manifest, draft);
  if (!instance) return errors;
  return errors.filter((error) => {
    const field = (manifest.secretFields || []).find((f) => error === `${f.label} is required`);
    return !(field && hasStoredSecret(instance, field));
  });
}

export function buildPayload(manifest: ProviderManifest, draft: Draft, editing: boolean): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const field of manifest.configFields || []) {
    const value = draft.config[field.key];
    if (value === undefined) continue;
    config[field.key] = typeof value === "string" ? value.trim() : value;
  }
  const secrets: Record<string, string> = {};
  for (const field of manifest.secretFields || []) {
    const value = String(draft.secrets[field.key] || "").trim();
    if (value) secrets[field.key] = value;
  }
  return {
    provider: manifest.provider,
    instanceKey: editing ? draft.instanceKey : draft.instanceKey.trim().toLowerCase(),
    label: draft.label.trim(),
    baseUrl: draft.baseUrl.trim(),
    deliveryMode: draft.deliveryMode,
    enabled: draft.enabled,
    isDefault: draft.isDefault,
    config,
    secrets,
  };
}

export function sourceFor(provider: string, instanceKey: string): string {
  return instanceKey && instanceKey !== "default" ? `${provider}:${instanceKey}` : provider;
}

export function webhookUrl(manifest: ProviderManifest, instanceKey: string, origin: string): string {
  const path = manifest.webhookPath || `/api/webhooks/${manifest.provider}`;
  const base = origin.replace(/\/+$/, "");
  return instanceKey && instanceKey !== "default" ? `${base}${path}/${encodeURIComponent(instanceKey)}` : `${base}${path}`;
}

export function sourceMatchesProvider(source: string, provider: string): boolean {
  return source === provider || source.startsWith(`${provider}:`);
}

export function sourcesForProvider(sources: SourceStat[], provider: string): SourceStat[] {
  return sources.filter((s) => sourceMatchesProvider(s.source, provider));
}

export function lastActivityFor(sources: SourceStat[], provider: string): string {
  return sourcesForProvider(sources, provider).reduce((latest, row) => (row.lastAt > latest ? row.lastAt : latest), "");
}

export function countFor(sources: SourceStat[], provider: string): number {
  return sourcesForProvider(sources, provider).reduce((sum, row) => sum + Number(row.n || 0), 0);
}

export function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "";
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
  }
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function statusTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "processed") return "success";
  if (status === "pending") return "warning";
  if (status === "processing") return "info";
  if (status === "dead_letter") return "danger";
  return "neutral";
}
