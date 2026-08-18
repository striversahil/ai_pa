import { D1PrismaClient } from './d1-prisma';

export const useInMemoryDb = false;

let _db: any = null;

export function initD1(env: any) {
  _db = env.DB || null;
}

export function getD1Database(): any {
  return _db;
}

export const prisma = new D1PrismaClient({
  prepare: (query: string) => {
    if (!_db) throw new Error('D1 database not initialized. Call initD1(env) first.');
    return _db.prepare(query);
  },
} as any);

export async function checkDatabaseConnection(): Promise<boolean> {
  return !!_db;
}