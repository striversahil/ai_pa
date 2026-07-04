import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection string'),
  LLM_API_KEY: z.string().min(1, 'LLM_API_KEY is required'),
  LLM_BASE_URL: z.string().url('LLM_BASE_URL must be a valid URL'),
  LLM_MODEL: z.string().min(1, 'LLM_MODEL name is required'),
  EMAIL_IMAP_HOST: z.string().min(1, 'EMAIL_IMAP_HOST is required'),
  EMAIL_IMAP_PORT: z.coerce.number().default(993),
  EMAIL_USER: z.string().email().or(z.string().min(1)),
  EMAIL_PASSWORD: z.string().min(1, 'EMAIL_PASSWORD is required'),
});

const result = configSchema.safeParse(process.env);

if (!result.success) {
  console.error('❌ Invalid environment configuration:', result.error.format());
  process.exit(1);
}

export const config = result.data;
