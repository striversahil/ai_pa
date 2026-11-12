// Extracted verbatim from service.ts by scripts/refactor/split-module.mjs.
// service.ts re-exports everything public here, so existing imports keep working.
import { config } from "../../../config";

// Mock detection stays here (drives the canned dev responses below); the real
// key pool lives in the unified gateway (src/shared/ai-gateway.ts).
export const isMockLLM = !config.LLM_API_KEY || config.LLM_API_KEY === 'your_api_key_here';
