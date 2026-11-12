// Extracted verbatim from service.ts by scripts/refactor/split-module.mjs.
// service.ts re-exports everything public here, so existing imports keep working.
import type { CampaignAgent } from "../types";

export interface ResolvedAgent extends CampaignAgent {
  secretName: string;
  /** '' when neither the DB mapping nor the secret yields a URL. */
  url: string;
}

export interface SendOutcome {
  id: string;
  ok: boolean;
  httpStatus: number | null;
  body: string;
}
