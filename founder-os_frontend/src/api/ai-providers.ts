// ai-providers.ts — domain api for the single AI gateway provider list.
// mirror: founder-os_backend/src/worker/routes/ai.ts (POST /api/ai/providers)
// Component rule: views call these helpers, never fetch() directly.
import { api } from "./client";

export interface AiProviderSummary {
  id: string;
  baseUrl: string;
  model: string;
  keys: number;
}

export async function manageAiProvider(
  action: "upsert-provider" | "add-keys" | "remove-key" | "delete-provider",
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; providers: AiProviderSummary[] }> {
  return api.post("/api/ai/providers", { action, ...payload });
}
