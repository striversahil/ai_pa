"use client";

import { useLiveDashboard } from "@/hooks/useLiveData";
import { getAiGateway } from "@/ai-gateway/api";
import type { AiGatewayPayload } from "@/ai-gateway/types";

/** Live AI gateway state for Settings: refreshed on the `settings` live event
 *  (config edits + health sweep writes) and after every mutation. */
export function useAiGateway() {
  const dash = useLiveDashboard<AiGatewayPayload>(getAiGateway, { events: ["settings"] });
  return {
    data: dash.data,
    loading: dash.loading,
    error: dash.error,
    refresh: dash.refresh,
  };
}
