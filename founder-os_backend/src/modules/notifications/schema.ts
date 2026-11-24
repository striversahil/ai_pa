// ─────────────────────────────────────────────────────────────────────────────
// modules/notifications/schema.ts — the LIVE schema of the D1 database, small
// enough to paste into an AI agent.
//
// Reads `sqlite_master` + `PRAGMA table_info` (read-only, introspective) for the
// tables schema-catalog.ts selects, and caches the block in KV for 10 minutes —
// introspection is ~45 round-trips, far too expensive to do per console load.
// ─────────────────────────────────────────────────────────────────────────────
import { cached } from '../../shared/cache';
import { pickTables, schemaText, tableNote, type SchemaTable } from './schema-catalog';

const CACHE_KEY = 'notification-schema:v2';
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface NotificationSchema {
  tables: SchemaTable[];
  text: string;
  generatedAt: string;
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

export async function loadNotificationSchema(db: any): Promise<NotificationSchema> {
  return cached<NotificationSchema>(CACHE_KEY, CACHE_TTL_MS, async () => {
    const picked = pickTables(await tableNames(db));
    const tables: SchemaTable[] = [];
    for (const table of picked) {
      try {
        const columns = await columnsOf(db, table);
        if (columns.length === 0) continue;
        tables.push({ table, note: tableNote(table), columns });
      } catch {
        // A table that cannot be introspected is simply not offered.
      }
    }
    return { tables, text: schemaText(tables), generatedAt: new Date().toISOString() };
  });
}
