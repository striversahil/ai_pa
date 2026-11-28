// db.ts — the one D1 handle for the Customer push module.
// Raw SQL (no Prisma shim): the ledger is Worker-only and core_customer is
// read with plain SELECTs, like master-data owns its own queries.
import { getD1Database } from '../../../shared/prisma-d1';

export function pushDb(): any {
  return getD1Database();
}
