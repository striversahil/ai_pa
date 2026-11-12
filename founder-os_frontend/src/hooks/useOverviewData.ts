"use client";

import { useLiveDashboard } from "@/hooks/useLiveData";
import { normalizeOverview } from "@/overview/normalize";
import type { OverviewPayload } from "@/overview/types";
import { workspaceDataUrl } from "@/workspaces/api";

/** Live overview fetcher for one variant slug (samarth-overview | sahil-overview). */
export function useOverviewData(slug: "samarth-overview" | "sahil-overview") {
  return useLiveDashboard<OverviewPayload | null>(async () => {
    const res = await fetch(workspaceDataUrl(slug));
    if (!res.ok) throw new Error(`overview load failed (${res.status})`);
    return normalizeOverview(await res.json());
  });
}
