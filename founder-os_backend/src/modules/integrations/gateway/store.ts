// store.ts — CRUD for hlp_integration_instance. SQL only (raw-SQL table).
//
// Writes bump the `integrations` cache revision; readers key their cached
// lookups on cacheRevs(['integrations']) so a console edit is visible to the
// very next call() without a deploy.

import { bumpRev } from '../../../shared/cache';
import type { InstanceRow, SqlDb } from './types';

const SELECT_ALL = 'SELECT * FROM hlp_integration_instance';

function rows<T>(result: { results?: T[] } | T[] | null): T[] {
  if (!result) return [];
  return Array.isArray(result) ? result : (result.results ?? []);
}

export function newInstanceId(): string {
  return 'ii_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function listInstances(db: SqlDb): Promise<InstanceRow[]> {
  return rows<InstanceRow>(
    (await db.prepare(`${SELECT_ALL} ORDER BY provider ASC, "isDefault" DESC, label ASC`).all()) as never,
  );
}

export async function getInstance(db: SqlDb, id: string): Promise<InstanceRow | null> {
  return (await db.prepare(`${SELECT_ALL} WHERE "id" = ?`).bind(id).first()) as InstanceRow | null;
}

export async function getByKey(
  db: SqlDb,
  provider: string,
  instanceKey: string,
): Promise<InstanceRow | null> {
  return (await db
    .prepare(`${SELECT_ALL} WHERE "provider" = ? AND "instanceKey" = ?`)
    .bind(provider, instanceKey)
    .first()) as InstanceRow | null;
}

export async function getDefault(db: SqlDb, provider: string): Promise<InstanceRow | null> {
  const hit = (await db
    .prepare(`${SELECT_ALL} WHERE "provider" = ? AND "isDefault" = 1 AND "enabled" = 1`)
    .bind(provider)
    .first()) as InstanceRow | null;
  if (hit) return hit;
  return getByKey(db, provider, 'default');
}

export interface InstanceWrite {
  provider: string;
  instanceKey: string;
  label: string;
  isDefault: boolean;
  enabled: boolean;
  deliveryMode: string;
  baseUrl: string;
  encryptedSecrets: string;
  configJson: string;
}

/** Insert or update the (provider, instanceKey) row. Returns its id. */
export async function upsertInstance(
  db: SqlDb,
  write: InstanceWrite,
  existing: InstanceRow | null,
): Promise<string> {
  const at = nowIso();
  if (existing) {
    await db
      .prepare(
        'UPDATE hlp_integration_instance SET "label" = ?, "isDefault" = ?, "enabled" = ?, ' +
          '"deliveryMode" = ?, "baseUrl" = ?, "encryptedSecrets" = ?, "configJson" = ?, "updatedAt" = ? ' +
          'WHERE "id" = ?',
      )
      .bind(
        write.label, write.isDefault ? 1 : 0, write.enabled ? 1 : 0,
        write.deliveryMode, write.baseUrl, write.encryptedSecrets, write.configJson, at,
        existing.id,
      )
      .run();
    await bumpRev('integrations').catch(() => undefined);
    return existing.id;
  }
  const id = newInstanceId();
  await db
    .prepare(
      'INSERT INTO hlp_integration_instance ' +
        '("id","provider","instanceKey","label","isDefault","enabled","deliveryMode","baseUrl","encryptedSecrets","configJson","createdAt","updatedAt") ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      id, write.provider, write.instanceKey, write.label,
      write.isDefault ? 1 : 0, write.enabled ? 1 : 0, write.deliveryMode,
      write.baseUrl, write.encryptedSecrets, write.configJson, at, at,
    )
    .run();
  await bumpRev('integrations').catch(() => undefined);
  return id;
}

/** At most one default per provider. */
export async function clearDefault(db: SqlDb, provider: string, keepId = ''): Promise<void> {
  await db
    .prepare('UPDATE hlp_integration_instance SET "isDefault" = 0 WHERE "provider" = ? AND "id" != ?')
    .bind(provider, keepId)
    .run();
  await bumpRev('integrations').catch(() => undefined);
}

export async function deleteInstance(db: SqlDb, id: string): Promise<void> {
  await db.prepare('DELETE FROM hlp_integration_instance WHERE "id" = ?').bind(id).run();
  await bumpRev('integrations').catch(() => undefined);
}
