import type { CallFilters, CallTotals, CallSource, DeviceCall, DeviceRow } from "./types";

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error || `request failed (${res.status})`);
  return body as T;
}

function query(filters: CallFilters): string {
  const p = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.agentId) p.set("agentId", filters.agentId);
  if (filters.direction) p.set("direction", filters.direction);
  if (filters.status) p.set("status", filters.status);
  if (filters.q) p.set("q", filters.q);
  return p.toString();
}

export async function fetchCalls(filters: CallFilters): Promise<{ calls: DeviceCall[]; viewer: { isManager: boolean } }> {
  return json(await fetch(`/api/call-log/calls?${query(filters)}`, { cache: "no-store" }));
}

export async function fetchSummary(filters: CallFilters): Promise<{ totals: CallTotals }> {
  return json(await fetch(`/api/call-log/summary?${query(filters)}`, { cache: "no-store" }));
}

export async function fetchSource(): Promise<{ mode: CallSource }> {
  return json(await fetch("/api/telecalling/manual-calls/mode", { cache: "no-store" }));
}

export async function setSource(mode: CallSource): Promise<{ mode: CallSource }> {
  return json(await fetch("/api/telecalling/manual-calls/mode", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  }));
}

export async function fetchDevices(): Promise<{ devices: DeviceRow[] }> {
  return json(await fetch("/api/call-log/devices", { cache: "no-store" }));
}

export async function issuePairCode(telecallerId: string): Promise<{ code: string; expiresAt: string }> {
  return json(await fetch("/api/call-log/devices/pair-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telecallerId }),
  }));
}

export async function setLoggingOnly(id: string, loggingOnly: boolean): Promise<void> {
  await json(await fetch(`/api/call-log/devices/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loggingOnly }),
  }));
}

export async function revokeDevice(id: string): Promise<void> {
  await json(await fetch(`/api/call-log/devices/${id}`, { method: "DELETE" }));
}
