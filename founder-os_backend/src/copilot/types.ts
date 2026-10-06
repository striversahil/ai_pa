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
  /** Opt out of engine-default tools (web_search, fetch_page, calculate). Default false = enabled for every copilot. */
  disableBuiltInTools?: boolean;
  /** Env var overriding the model, e.g. 'ENQUIRY_CHAT_MODEL'. */
  modelEnvVar: string;
  defaultModel: string;
  /** Max USER turns per hour for non-root users (default 20). Counts one per
   *  user turn at entry — the LLM's own tool steps never consume budget.
   *  Root bypasses. Set 0/negative for unlimited. */
  hourlyLimit?: number;
  /** Max agentic tool steps per turn (default 6). Bulk-style defs that
   *  chain reads → searches → proposals raise this so work finishes instead
   *  of stalling mid-pipeline. */
  maxSteps?: number;
  /** Carry last turn's tool outputs into the next turn's prompt (default
   *  false). When true, tool results persist in KV and are appended to the
   *  system prompt — later turns continue from them instead of re-running
   *  the same reads. For data-working defs (bulk), not chit-chat. */
  keepToolOutputs?: boolean;
  /** Reply when the model returns no content. */
  emptyHint: string;
  /** Max chars of a tool result JSON sent back to the model (default 3000).
   *  Bulk-style defs that page row text raise this so one read covers the
   *  batch instead of N paged calls hammering RPM limits. */
  toolResultCap?: number;
}
