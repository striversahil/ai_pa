import { useInMemoryDb } from '../shared/prisma';
import { getD1Database } from '../shared/prisma-d1';
import type { StorageProvider } from './interfaces';
import { PrismaStorageProvider } from './prisma-provider';
import { InMemoryStorageProvider } from './in-memory-provider';
import { D1StorageProvider } from './d1-provider';

let prismaProvider: PrismaStorageProvider | null = null;
let inMemoryProvider: InMemoryStorageProvider | null = null;
let d1Provider: D1StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (useInMemoryDb) {
    if (!inMemoryProvider) inMemoryProvider = new InMemoryStorageProvider();
    return inMemoryProvider;
  }
  const d1 = getD1Database();
  if (d1) {
    if (!d1Provider) d1Provider = new D1StorageProvider(d1);
    return d1Provider;
  }
  if (!prismaProvider) prismaProvider = new PrismaStorageProvider();
  return prismaProvider;
}