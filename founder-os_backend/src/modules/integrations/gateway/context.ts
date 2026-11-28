// context.ts — the per-request bindings call() needs (env for keys/KV, db for
// instances). Routes bind it once at the top; nothing else mutates it.

import type { SqlDb } from './types';

export interface GatewayContext {
  db: SqlDb;
  env: Record<string, unknown>;
}

let current: GatewayContext | null = null;

export function bindGatewayContext(ctx: GatewayContext): void {
  current = ctx;
}

export function gatewayContext(): GatewayContext {
  if (!current) throw new Error('gateway context not bound (call bindGatewayContext() first)');
  return current;
}
