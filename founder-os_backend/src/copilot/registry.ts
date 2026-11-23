// copilot/registry.ts — department copilot registry.
//
// Founder decision 2026-11-22: the Product Line AI agents (knowledge Q&A +
// "Add vendor rates" intake) were removed with the Product Line data wipe, so
// the registry is currently EMPTY. The engine (runTurn/streamTurn), the
// /api/copilot/:id/* routes and the sales copilot (its own store-bound routes
// in worker/routes/enquiries.ts) stay in place.
//
// To add a department copilot:
//   1. implement CopilotDef in the department module (see copilot/types.ts),
//   2. add it to COPILOTS below.
// No engine or route changes needed — /api/copilot/<id>/chat|stream|execute
// dispatch through this registry.
import type { CopilotDef } from './types';

const COPILOTS: Record<string, CopilotDef<any>> = {};

export function getCopilot(id: string): CopilotDef<any> | null {
  return COPILOTS[String(id ?? '').toLowerCase()] ?? null;
}

export function copilotIds(): string[] {
  return Object.keys(COPILOTS);
}
