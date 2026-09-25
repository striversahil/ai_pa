// copilot/types.ts — shared AI-copilot contract (edge-safe: types only).
//
// A department copilot is ONE CopilotDef: id + access check + system prompt +
// tool list + tool executor. The agentic loop lives in ./engine and is reused
// verbatim by every department (sales enquiries, product line, ...).
// To add a department: implement CopilotDef in the department module and
// register it in ./registry. No engine or route changes needed.
import type { ToolDefinition } from '../shared/ai-gateway';

export interface CopilotProposal {
  kind: string;
  label: string;
  [k: string]: any;
}

export interface CopilotActivity {
  tool: string;
  label: string;
}

export interface CopilotReply {
  reply: string;
  proposals: CopilotProposal[];
  activity: CopilotActivity[];
}

export interface CopilotExecResult {
  result: { status: number; body: any };
  applied: string;
}

export interface CopilotDef<T> {
  /** URL id: /api/copilot/<id>/chat */
  id: string;
  /** Null = allowed; otherwise { status, error } for the route to return. */
  checkAccess(me: any): { status: number; error: string } | null;
  /** Per-turn context (stores, scope flags). Stateless — never keeps history. */
  buildCtx(env: Record<string, unknown>, me: any, extra: Record<string, string>): Promise<T> | T;
  /** Gateway sticky-key pin (consistent-hash, no mid-turn hopping). */
  sessionKey(ctx: T): string;
  /** Rolling conversation recall (last exchanges, KV-backed, truncated). Null/absent = stateless turns (sales). */
  historyKey?(ctx: T): string | null;
  /** History TTL ms (default 30 min). */
  historyTtlMs?: number;
  /** Max stored messages, user+assistant interleaved (default 12). */
  historyMaxMsgs?: number;
  /** Extra per-copilot state to wipe on new-chat (e.g. intake draft). */
  clearExtra?(ctx: T): Promise<void>;
  /** Best-effort turn counter key (history is never stored). Null = skip. */
  countKey(ctx: T): string | null;
  systemPrompt(ctx: T): string;
  toolDefs(ctx: T): ToolDefinition[];
  execTool(ctx: T, name: string, args: Record<string, any>): Promise<{ result: unknown; proposals?: CopilotProposal[] }>;
  /** One-line chime shown in the UI while a tool runs. */
  activityLabel(name: string, args: Record<string, any>, out: { result: unknown }): string;
  /** Confirm path for proposals. Absent = read-only copilot (no execute). */
  executeProposal?(ctx: T, action: Record<string, any>): Promise<CopilotExecResult>;
  /** Env var overriding the model, e.g. 'ENQUIRY_CHAT_MODEL'. */
  modelEnvVar: string;
  defaultModel: string;
  /** Reply when the model returns no content. */
  emptyHint: string;
}
