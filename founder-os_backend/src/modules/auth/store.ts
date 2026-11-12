import { MemoryAuthStore, D1AuthStore } from "./store-parts/io";
import type { AuthStore } from "./store-parts/types";

// Pieces split into ./store-parts/ (importable on their own); re-exported for compat.
export type { AuthStore } from "./store-parts/types";

let cachedMemory: MemoryAuthStore | null = null;

export function createAuthStore(env: any): AuthStore {
  if (env && env.DB && typeof env.DB.prepare === "function") return new D1AuthStore(env.DB);
  // Prisma store is wired by the Express server (store-prisma.ts).
  if (env && env.__prismaAuthStore) return env.__prismaAuthStore as AuthStore;
  if (!cachedMemory) cachedMemory = new MemoryAuthStore();
  return cachedMemory;
}

export { MemoryAuthStore };
