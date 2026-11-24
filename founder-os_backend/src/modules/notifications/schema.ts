// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/schema.ts — the LIVE schema of the D1 database, small
// enough to paste into an AI agent, WITH the relationships between tables.
//
// Reads `sqlite_master` + `PRAGMA table_info` + `PRAGMA foreign_key_list`
// (read-only, introspective) for the tables schema-catalog.ts selects, merges
// the code-side edges (generated ./relations.ts from Prisma + the runtime ORM
// map) and the curated no-FK joins, then caches the whole block in KV for 10
// minutes — introspection is ~45 round-trips, far too expensive per console load.
// ─────────────────────────────────────────────────────────────────────────────
import { cached } from '../../shared/cache';
import {
  applicationJoinsFor,
  inferJoins,
  mergeJoins,
  pickTables,
  schemaText,
  tableNote,
  type SchemaTable,
  type TableJoin,
} from './schema-catalog';
import { RELATIONS_BY_TABLE } from './relations';

const CACHE_KEY = 'notification-schema:v3';
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface NotificationSchema {
  tables: SchemaTable[];
  text: string;
  generatedAt: string;
  /** Total relationship edges in the block (all kinds). */
  relationships: number;
}

async function tableNames(db: any): Promise<string[]> {
  const res: any = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all();
  return (((res?.results ?? []) as any[]).map((r) => String(r?.name ?? '')).filter(Boolean));
}

async function columnsOf(db: any, table: string): Promise<Array<{ name: string; type: string }>> {
  const quoted = table.replace(/"/g, '""');
  const res: any = await db.prepare(`PRAGMA table_info("${quoted}")`).all();
  return (((res?.results ?? []) as any[]).map((c) => ({
    name: String(c?.name ?? ''),
    type: String(c?.type ?? ''),
  }))).filter((c) => c.name);
}

/** Real `REFERENCES` from the migrations — the only edges the DB itself
 *  enforces. Many D1 tables have none, which is exactly why the code-derived
 *  edges exist. */
async function fksOf(db: any, table: string): Promise<TableJoin[]> {
  const quoted = table.replace(/"/g, '""');
  try {
    const res: any = await db.prepare(`PRAGMA foreign_key_list("${quoted}")`).all();
    return (((res?.results ?? []) as any[])
      .map((f) => ({
        field: String(f?.from ?? ''),
        model: String(f?.table ?? ''),
        ref: String(f?.to ?? 'id'),
        kind: 'fk' as const,
      }))
      .filter((j) => j.field && j.model));
  } catch {
    return [];
  }
}

function codeJoinsOf(table: string): TableJoin[] {
  return (RELATIONS_BY_TABLE[table] ?? []).map((e) => ({
    field: e.field,
    model: e.model,
    ref: e.ref,
    kind: e.kind,
  }));
}

export async function loadNotificationSchema(db: any): Promise<NotificationSchema> {
  return cached<NotificationSchema>(CACHE_KEY, CACHE_TTL_MS, async () => {
    const picked = pickTables(await tableNames(db));
    const tables: SchemaTable[] = [];
    for (const table of picked) {
      try {
        const columns = await columnsOf(db, table);
        if (columns.length === 0) continue;
        const joins = mergeJoins(
          await fksOf(db, table),
          codeJoinsOf(table),
          applicationJoinsFor(table),
          inferJoins(table, columns.map((c) => c.name), picked),
        );
        tables.push({ table, note: tableNote(table), columns, joins });
      } catch {
        // A table that cannot be introspected is simply not offered.
      }
    }
    const relationships = tables.reduce((n, t) => n + (t.joins ?? []).length, 0);
    return { tables, text: schemaText(tables), generatedAt: new Date().toISOString(), relationships };
  });
}
