// copilot/registry.ts — department copilot registry.
//
// One entry per department. To add a department copilot:
//   1. implement CopilotDef in the department module (see
//      automations/product-line/copilot.ts for the reference), and
//   2. add it to COPILOTS below.
// No engine or route changes needed — /api/copilot/<id>/chat|stream|execute
// dispatch through this registry.
import type { CopilotDef } from './types';
import { productLineCopilotDef } from '../automations/product-line/copilot';
import { productLineIntakeDef } from '../automations/product-line/intake';

const COPILOTS: Record<string, CopilotDef<any>> = {
  [productLineCopilotDef.id]: productLineCopilotDef,
  [productLineIntakeDef.id]: productLineIntakeDef,
};

export function getCopilot(id: string): CopilotDef<any> | null {
  return COPILOTS[String(id ?? '').toLowerCase()] ?? null;
}

export function copilotIds(): string[] {
  return Object.keys(COPILOTS);
}
