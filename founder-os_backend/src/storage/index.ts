import { useInMemoryDb } from '../shared/prisma';
import type { StorageProvider } from './interfaces';
import { PrismaStorageProvider } from './prisma-provider';
import { InMemoryStorageProvider } from './in-memory-provider';

let prismaProvider: PrismaStorageProvider | null = null;
let inMemoryProvider: InMemoryStorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (useInMemoryDb) {
    if (!inMemoryProvider) inMemoryProvider = new InMemoryStorageProvider();
    return inMemoryProvider;
  }
  if (!prismaProvider) prismaProvider = new PrismaStorageProvider();
  return prismaProvider;
}