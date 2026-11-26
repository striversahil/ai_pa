// ai-gateway/api.ts — the ONLY fetch surface for the AI gateway panel.
// mirror: founder-os_backend/src/worker/routes/ai-controls.ts (PATCH/enable)
//         + ai-playground.ts (pinned probe, SSE) + ai.ts (GET /api/ai/health)
import { api } from "@/api/client";
import type { AiGatewayPayload, KeyCallRow, ProbeMetrics, ProbeResult } from "./types";

export async function getAiGateway(): Promise<AiGatewayPayload> {
  return api.get<AiGatewayPayload>("/api/ai/health");
}

export async function setProviderEnabled(providerId: string, enabled: boolean): Promise<AiGatewayPayload> {
  return api.patch<AiGatewayPayload>(`/api/ai/providers/${encodeURIComponent(providerId)}`, { enabled });
}

export async function setKeyEnabled(providerId: string, keyId: string, enabled: boolean): Promise<AiGatewayPayload> {
  return api.patch<AiGatewayPayload>(
    `/api/ai/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}`,
    { enabled },
  );
}

/** Persist health thresholds (Setting ai:health) — root-only settings PUT. */
export async function saveHealthPolicy(cfg: {
  threshold: number; atRisk: number; minSamples: number;
  tpsTarget: number; ttftGoodMs: number; ttftBadMs: number; autoDisable: boolean;
}): Promise<void> {
  await api.put(`/api/settings/${encodeURIComponent("ai:health")}`, { value: JSON.stringify(cfg) });
}

export async function getKeyCalls(limit = 100): Promise<{ ok: boolean; rows: KeyCallRow[] }> {
  return api.get<{ ok: boolean; rows: KeyCallRow[] }>(`/api/ai/key-calls?limit=${limit}`);
}

export async function probeKey(payload: {
  provider: string; keyId: string; prompt: string; system?: string;
}): Promise<ProbeResult & { provider: string; model: string }> {
  return api.post("/api/ai/test", payload);
}

export interface StreamHandlers {
  onMeta?: (meta: { provider: string; keyId: string; label?: string }) => void;
  onDelta?: (text: string) => void;
  onDone?: (result: ProbeResult) => void;
  onError?: (message: string) => void;
}

/** POST /api/ai/test/stream — hand-parsed SSE (the Pages proxy forwards the
 *  Worker stream unchanged; EventSource is GET-only so fetch is required). */
export async function streamProbe(
  payload: { provider: string; keyId: string; prompt: string; system?: string },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/ai/test/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Probe failed (${res.status})`);
  }
  if (!res.body) throw new Error("Streaming unavailable");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let metrics: ProbeMetrics | null = null;
  let errorMessage: string | null = null;

  const handleEvent = (raw: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length === 0) return;
    let parsed: any;
    try { parsed = JSON.parse(data.join("\n")); } catch { return; }
    if (event === "meta") handlers.onMeta?.(parsed);
    else if (event === "delta") {
      const text = String(parsed?.text ?? "");
      content += text;
      if (text) handlers.onDelta?.(text);
    } else if (event === "done") {
      metrics = {
        latencyMs: Number(parsed?.latencyMs) || 0,
        ttftMs: parsed?.ttftMs == null ? null : Number(parsed.ttftMs),
        completionTokens: Number(parsed?.completionTokens) || 0,
        totalTokens: Number(parsed?.totalTokens) || 0,
        tps: parsed?.tps == null ? null : Number(parsed.tps),
      };
      handlers.onDone?.({ content: String(parsed?.content ?? content), metrics });
    } else if (event === "error") {
      errorMessage = String(parsed?.message ?? "Probe failed");
      handlers.onError?.(errorMessage);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx >= 0) {
      handleEvent(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
      idx = buffer.indexOf("\n\n");
    }
  }
  // A stream that ends with neither done nor error (connection dropped) must
  // surface as a failure, never as an empty success.
  if (!metrics && !errorMessage) throw new Error("Probe stream ended unexpectedly");
}
