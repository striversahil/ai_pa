"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const zod_1 = require("zod");
// Load environment variables from .env file
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../.env') });
const configSchema = zod_1.z.object({
    PORT: zod_1.z.coerce.number().default(3000),
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: zod_1.z.string().url('DATABASE_URL must be a valid connection string'),
    LLM_API_KEY: zod_1.z.string().min(1, 'LLM_API_KEY is required'),
    LLM_BASE_URL: zod_1.z.string().url('LLM_BASE_URL must be a valid URL'),
    LLM_MODEL: zod_1.z.string().min(1, 'LLM_MODEL name is required'),
    EMAIL_IMAP_HOST: zod_1.z.string().min(1, 'EMAIL_IMAP_HOST is required'),
    EMAIL_IMAP_PORT: zod_1.z.coerce.number().default(993),
    EMAIL_USER: zod_1.z.string().email().or(zod_1.z.string().min(1)),
    EMAIL_PASSWORD: zod_1.z.string().min(1, 'EMAIL_PASSWORD is required'),
});
const result = configSchema.safeParse(process.env);
if (!result.success) {
    console.error('❌ Invalid environment configuration:', result.error.format());
    process.exit(1);
}
exports.config = result.data;
