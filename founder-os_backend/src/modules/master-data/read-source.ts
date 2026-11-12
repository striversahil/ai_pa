// read-source.ts — Phase 3a display-flip switch (flag + guarded core read).
//
// `masterdata:readCore` Setting, default OFF: legacy MasterCustomer stays the
// read truth until a quiet `customer-shadow` week + human confirmation. When
// ON, the payload reads `core_customer` with a per-compute legacy COUNT(*)
// sanity check; any error or count drift → warn + legacy rows, so a bad flip
// can never serve a wrong book. Nothing here ever throws.
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import {
  countCustomers, countCustomersCore, listAllCustomers, listAllCustomersCore,
} from './store';

export const MASTER_READ_CORE_KEY = 'masterdata:readCore';

export async function getMasterReadCore(): Promise<boolean> {
  try {
    const row: any = await prisma.setting.findUnique({ where: { key: MASTER_READ_CORE_KEY } });
    return String(row?.value ?? '').trim() === '1';
  } catch {
    return false;
  }
}

/** Persist the flip. Callers bust the payload cache after (service owns it). */
export async function setMasterReadCore(on: unknown): Promise<boolean> {
  const next = on === true || on === '1' || on === 1;
  const now = new Date().toISOString();
  await prisma.setting.upsert({
    where: { key: MASTER_READ_CORE_KEY },
    update: { value: next ? '1' : '0', updatedAt: new Date(now) as any },
    create: { key: MASTER_READ_CORE_KEY, value: next ? '1' : '0', updatedAt: new Date(now) as any } as any,
  });
  return next;
}

/** Book rows for the dashboard payload: core when the flag is ON (verified
 *  against legacy every compute — one COUNT(*) per cache window), else the
 *  legacy book directly. */
export async function readBookRows(): Promise<any[]> {
  if (!(await getMasterReadCore())) return listAllCustomers();
  try {
    const [coreRows, legacyCount] = await Promise.all([listAllCustomersCore(), countCustomers()]);
    if (coreRows.length !== legacyCount) {
      logger.warn({ core: coreRows.length, legacy: legacyCount }, 'master-data read-core count mismatch — serving legacy (non-blocking)');
      return listAllCustomers();
    }
    return coreRows;
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'master-data read-core failed — serving legacy (non-blocking)');
    return listAllCustomers();
  }
}

/** Header count matching whichever book the payload serves. */
export async function readBookCount(): Promise<number> {
  if (!(await getMasterReadCore())) return countCustomers();
  try {
    return await countCustomersCore();
  } catch {
    return countCustomers();
  }
}
