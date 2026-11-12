// copilot/engine.ts — generic agentic chat loop (edge-safe: fetch only).
//
// Extracted verbatim from modules/enquiries/chat.ts so every department
// copilot shares one loop: Agnes-pool first via the GH relay lane ONLY
// (direct Cloudflare egress is WAF-blocked — never attempted), paid
// OpenRouter fallback; max 6 tool steps, writes never applied (tools return
// proposals; the frontend confirms via /execute).
// Chat history is deliberately NOT stored — only a best-effort turn counter.


// Pieces split into ./engine-parts/ (importable on their own); re-exported for compat.
export { CHAT_PROVIDER, MAX_HUMAN_TURNS, LIMIT_REPLY, usageKey } from "./engine-parts/pure";
export { readChatUsage, runTurn, streamTurn } from "./engine-parts/io";

export * from './session';
