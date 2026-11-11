// modules/core/stages.ts — the single order stage-transition function.
// Phase 0 stub: stage lists only. Phase 4 implements transition_order() which
// checks the TRANSITION perm + every core_stage_gate row, then writes the
// stage event + domain event + opens the next department's core_action.
export const SALES_ORDER_STAGES = [
  'DRAFT',
  'CONFIRMED',
  'ACCOUNTS_VERIFIED',
  'STOCK_CONFIRMED',
  'PAYMENT_CONFIRMED',
  'READY_TO_DISPATCH',
  'PARTIALLY_DISPATCHED',
  'DISPATCHED',
  'DELIVERED',
  'CLOSED',
  'ON_HOLD',
  'CANCELLED',
] as const;

export type SalesOrderStage = (typeof SALES_ORDER_STAGES)[number];

export function isTerminalStage(stage: string): boolean {
  return stage === 'DELIVERED' || stage === 'CLOSED' || stage === 'CANCELLED';
}
