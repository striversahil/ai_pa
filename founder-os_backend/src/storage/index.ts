import { useInMemoryDb } from '../shared/prisma';
import type { StorageProvider } from './interfaces';
import { PrismaStorageProvider } from './prisma-provider';
import { InMemoryStorageProvider } from './in-memory-provider';

let provider: StorageProvider;
if (useInMemoryDb) {
  provider = new InMemoryStorageProvider();
} else {
  provider = new PrismaStorageProvider();
}

export function getStorageProvider(): StorageProvider {
  return provider;
}
