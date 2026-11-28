// book.ts — read-only queries over the customer book (core_customer).
// A push never writes it; every count here is the same predicate the
// selection uses, so preview and payload can never disagree.
import { pushDb } from './db';
import { LIVE_CUSTOMER_WHERE, CUSTOMER_COLUMNS } from './pure';

/** Every customer row for one region + state (+ optional district + type). */
export async function listCustomersByState(region: string, state: string, clientType = '', district = ''): Promise<any[]> {
  const db = pushDb();
  if (!db) return [];
  const type = String(clientType ?? '').trim();
  const dist = String(district ?? '').trim();
  const conds = ['region = ?', 'state = ?', LIVE_CUSTOMER_WHERE];
  const binds: string[] = [region, state];
  if (dist) { conds.push('district = ?'); binds.push(dist); }
  if (type) { conds.push('customerTypeBase = ?'); binds.push(type); }
  const res = await db
    .prepare(`SELECT ${CUSTOMER_COLUMNS} FROM core_customer WHERE ${conds.join(' AND ')} ORDER BY id`)
    .bind(...binds)
    .all();
  return (res?.results ?? []) as any[];
}

/** Region-scoped state list with phone coverage — the dropdown's source. */
export async function listStateCounts(region: string, clientType = ''): Promise<Array<{ state: string; total: number; withPhone: number }>> {
  const db = pushDb();
  if (!db) return [];
  const type = String(clientType ?? '').trim();
  const conditions = ['region = ?', LIVE_CUSTOMER_WHERE];
  const binds: string[] = [region];
  if (type) { conditions.push('customerTypeBase = ?'); binds.push(type); }
  const res = await db.prepare(
    `SELECT state,
            COUNT(*) AS total,
            SUM(CASE WHEN phonesJson NOT IN ('[]', '') AND phonesJson IS NOT NULL THEN 1 ELSE 0 END) AS withPhone
       FROM core_customer
      WHERE ${conditions.join(' AND ')}
      GROUP BY state
      ORDER BY total DESC, state ASC`,
  ).bind(...binds).all();
  return ((res?.results ?? []) as any[]).map((r) => ({
    state: String(r?.state ?? ''),
    total: Number(r?.total ?? 0),
    withPhone: Number(r?.withPhone ?? 0),
  }));
}

/** District list for one region + state (+ optional type) with phone coverage.
 *  Only placed districts list — unplaced rows ('') stay reachable through the
 *  whole-state push, never as a district of their own. */
export async function listDistrictCounts(region: string, state: string, clientType = ''): Promise<Array<{ district: string; total: number; withPhone: number }>> {
  const db = pushDb();
  if (!db) return [];
  const type = String(clientType ?? '').trim();
  const conds = ['region = ?', 'state = ?', "district <> ''", LIVE_CUSTOMER_WHERE];
  const binds: string[] = [region, state];
  if (type) { conds.push('customerTypeBase = ?'); binds.push(type); }
  const res = await db.prepare(
    `SELECT district,
            COUNT(*) AS total,
            SUM(CASE WHEN phonesJson NOT IN ('[]', '') AND phonesJson IS NOT NULL THEN 1 ELSE 0 END) AS withPhone
       FROM core_customer
      WHERE ${conds.join(' AND ')}
      GROUP BY district
      ORDER BY total DESC, district ASC`,
  ).bind(...binds).all().catch(() => null);
  return ((res?.results ?? []) as any[]).map((r) => ({
    district: String(r?.district ?? ''),
    total: Number(r?.total ?? 0),
    withPhone: Number(r?.withPhone ?? 0),
  }));
}

/** Client-type list for one region (+ optional state + district) with coverage. */
export async function listTypeCounts(region: string, state = '', district = ''): Promise<Array<{ base: string; total: number; withPhone: number }>> {
  const db = pushDb();
  if (!db) return [];
  const st = String(state ?? '').trim();
  const dist = String(district ?? '').trim();
  const conds = ['region = ?', LIVE_CUSTOMER_WHERE];
  const binds: string[] = [region];
  if (st) { conds.push('state = ?'); binds.push(st); }
  if (dist) { conds.push('district = ?'); binds.push(dist); }
  const res = await db.prepare(
    `SELECT customerTypeBase AS base,
            COUNT(*) AS total,
            SUM(CASE WHEN phonesJson NOT IN ('[]', '') AND phonesJson IS NOT NULL THEN 1 ELSE 0 END) AS withPhone
       FROM core_customer
      WHERE ${conds.join(' AND ')}
      GROUP BY customerTypeBase
      ORDER BY total DESC, base ASC`,
  ).bind(...binds).all();
  return ((res?.results ?? []) as any[]).map((r) => ({
    base: String(r?.base ?? '').trim() || 'Unspecified',
    total: Number(r?.total ?? 0),
    withPhone: Number(r?.withPhone ?? 0),
  }));
}

/** Last completed push per state (+ type) — the "this repeats" warning. */
export async function lastLivePushes(region: string, clientType = ''): Promise<Map<string, { at: string; count: number }>> {
  const db = pushDb();
  const out = new Map<string, { at: string; count: number }>();
  if (!db) return out;
  const type = String(clientType ?? '').trim();
  const conds = ["region = ?", "mode = 'live'", "status = 'done'"];
  const binds: string[] = [region];
  if (type) { conds.push('clientType = ?'); binds.push(type); }
  try {
    const res = await db.prepare(
      `SELECT state, MAX(finishedAt) AS at, SUM(sent) AS sent
         FROM CustomerPushBatch
        WHERE ${conds.join(' AND ')}
        GROUP BY state`,
    ).bind(...binds).all();
    for (const row of ((res?.results ?? []) as any[])) {
      const state = String(row?.state ?? '');
      if (!state) continue;
      out.set(state, { at: String(row?.at ?? ''), count: Number(row?.sent ?? 0) });
    }
  } catch {
    // Ledger not migrated yet — the UI simply shows no history.
  }
  return out;
}

/** Last completed push per district (+ optional type). */
export async function lastDistrictPushes(region: string, state: string, clientType = ''): Promise<Map<string, { at: string; count: number }>> {
  const db = pushDb();
  const out = new Map<string, { at: string; count: number }>();
  if (!db) return out;
  const type = String(clientType ?? '').trim();
  const conds = ["region = ?", "state = ?", "mode = 'live'", "status = 'done'", "district <> ''"];
  const binds: string[] = [region, state];
  if (type) { conds.push('clientType = ?'); binds.push(type); }
  try {
    const res = await db.prepare(
      `SELECT district, MAX(finishedAt) AS at, SUM(sent) AS sent
         FROM CustomerPushBatch
        WHERE ${conds.join(' AND ')}
        GROUP BY district`,
    ).bind(...binds).all();
    for (const row of ((res?.results ?? []) as any[])) {
      const district = String(row?.district ?? '');
      if (!district) continue;
      out.set(district, { at: String(row?.at ?? ''), count: Number(row?.sent ?? 0) });
    }
  } catch {
    // Pre-0145 ledger without the district column — no district history.
  }
  return out;
}
