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
  NOTION_API_KEY: z.string().min(1, 'NOTION_API_KEY is required'),
  NOTION_DATABASE_ID: z.string().min(1, 'NOTION_DATABASE_ID is required'),
  HF_API_KEY: z.string().optional().default(''),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  WAHA_API_URL: z.string().default('http://localhost:3002'),
  WAHA_API_KEY: z.string().default('MyLocalSecretKey!'),
  WAHA_SESSION_NAME: z.string().default('default'),
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: z.string().optional().default(''),
  WHATSAPP_CLOUD_ACCESS_TOKEN: z.string().optional().default(''),
  WHATSAPP_CLOUD_API_VERSION: z.string().default('v21.0'),
  AISENSY_API_KEY: z.string().optional().default(''),
  AISENSY_BASE_URL: z.string().default('https://backend.aisensy.com'),
  MESSAGE_SLA_MINUTES: z.coerce.number().default(15),
  DIGEST_CRON_INTERVAL: z.string().default('*/5 * * * *'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  SLACK_WEBHOOK_URL: z.string().optional(),
});

const result = configSchema.safeParse(process.env);

if (!result.success) {
  console.error('❌ Invalid environment configuration:', result.error.format());
  process.exit(1);
}

export const config = result.data;
