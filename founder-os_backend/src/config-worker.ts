import { z } from 'zod';

const env = (globalThis as any).__WORKER_ENV__ || {};

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  DATABASE_URL: z.string().optional().default(''),
  LLM_API_KEY: z.string().default(''),
  LLM_BASE_URL: z.string().url().default('http://127.0.0.1:20128/v1'),
  LLM_MODEL: z.string().default('groq/openai/gpt-oss-120b'),
  EMAIL_IMAP_HOST: z.string().default(''),
  EMAIL_IMAP_PORT: z.coerce.number().default(993),
  EMAIL_USER: z.string().default(''),
  EMAIL_PASSWORD: z.string().default(''),
  NOTION_API_KEY: z.string().default(''),
  NOTION_DATABASE_ID: z.string().default(''),
  HF_API_KEY: z.string().optional().default(''),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  WA_ENGINE_BASE_URL: z.string().url().default('https://waengine.pro/api/v1'),
  WA_ENGINE_API_KEY: z.string().default(''),
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
  SHARED_SECRET: z.string().optional().default(''),
});

const result = configSchema.safeParse(env);
if (!result.success) {
  console.error('Invalid worker environment configuration:', result.error.format());
}

export const config = result.success ? result.data : (configSchema.parse({}));