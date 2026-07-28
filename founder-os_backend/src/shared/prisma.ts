import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'stdout', level: 'error' },
    { emit: 'stdout', level: 'info' },
    { emit: 'stdout', level: 'warn' },
  ],
});

// Log Prisma queries in development mode for easier debugging
prisma.$on('query' as any, (e: any) => {
  logger.debug(`Prisma Query: ${e.query} | Params: ${e.params} | Duration: ${e.duration}ms`);
});

// Global flag to track memory fallback status
export let useInMemoryDb = false;

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    logger.info('Testing connection to PostgreSQL database...');
    // Quick test query
    await prisma.$queryRaw`SELECT 1`;
    logger.info('✅ PostgreSQL database connection successful.');
    
    // Bootstrap pgvector
    try {
      logger.info('Ensuring pgvector extension and schema columns are initialized...');
      await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector;');
      await prisma.$executeRawUnsafe('ALTER TABLE "BrainContext" ADD COLUMN IF NOT EXISTS "embedding" vector(384);');
      logger.info('✅ Database pgvector setup complete.');
    } catch (dbError: any) {
      logger.error({ error: dbError.message }, 'Failed to initialize pgvector database structures. RAG features might not work correctly.');
    }

    useInMemoryDb = false;
    return true;
  } catch (error: any) {
    logger.warn('⚠️ Database connection failed or is unconfigured.');
    logger.warn('👉 App will run in IN-MEMORY DATABASE mode with pre-seeded mock records.');
    useInMemoryDb = true;
    return false;
  }
}
