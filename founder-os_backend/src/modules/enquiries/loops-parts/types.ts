// Extracted verbatim from loops.ts by scripts/refactor/split-module.mjs.
// loops.ts re-exports everything public here, so existing imports keep working.
import type { LoopParty } from "../types";

export interface LoopWriter {
  privileged: boolean;
  restricted: boolean;
  actingProcurement: boolean;
  /** Writer desk (surface-aware, same derivation as the old trail role). */
  desk: LoopParty;
}
