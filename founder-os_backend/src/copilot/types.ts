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
  /** More work remains: the turn stopped early so its HTTP hop stays under
   *  the edge ~100s guillotine — the client auto-continues (same session)
   *  without user action. NOT an AI limit: steps/tokens stay unbounded. */
  continued?: boolean;
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
  /** Execute a tool. `message` is the turn's raw user text, threaded through
   *  for tools that need the verbatim paste (e.g. blob ingestion) without
   *  the model re-emitting it through args (which the completion cap would
   *  truncate). Defs that ignore it are unaffected. */
  execTool(ctx: T, name: string, args: Record<string, any>, message?: string): Promise<{ result: unknown; proposals?: CopilotProposal[] }>;
  /** One-line chime shown in the UI while a tool runs. */
  activityLabel(name: string, args: Record<string, any>, out: { result: unknown }): string;
  /** "Starting" chime shown the moment a tool call begins (before it
   *  returns) so multi-second tools never look stuck. Optional — engine
   *  falls back to `Running <tool>…`. */
  activityStartLabel?(name: string, args: Record<string, any>): string;
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
  /** Max tool calls executed per model step (default 3), run in PARALLEL via
   *  Promise.all (results re-attached in order). Defs whose tools are pure +
   *  independent (intake reads/captures) raise this so a 14-quote blob
   *  resolves in a few wide steps instead of dozens of sequential ones. */
  maxParallelTools?: number;
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
  /** Max chars of carried-forward tool trace in the next turn's prompt
   *  (default 12000). Long-pipeline defs (intake) raise this so a 14-quote
   *  blob's split + captures all survive into "continue". */
  traceCap?: number;
  /** Max chars per recent history message SENT to the model (default 1200).
   *  Defs whose user message IS the working data (pasted blobs) raise this
   *  or resume turns only ever see the head of the paste. */
  historyRecentCap?: number;
  /** Max chars per message STORED in rolling history (default 1500). Raise
   *  alongside historyRecentCap or there is nothing fuller to send. */
  historyStoreCap?: number;
  /** Max TOTAL chars of history sent per turn, trimmed oldest-first (default
   *  24000 — under it, current per-message caps can never overflow it, so
   *  other defs are unaffected). Defs carrying whole pastes (intake) raise
   *  this instead of piling uncapped messages onto every prompt. */
  historyTotalCap?: number;
  /** Per-hop wall clock ms (default 80000): a turn yields here so its HTTP
   *  request never meets the edge ~100s guillotine (which answers long
   *  requests with an HTML error page, not JSON). The client chains the
   *  next hop automatically from saved state — TRANSPORT chunking only,
   *  never a limit on the AI's total work. */
  turnBudgetMs?: number;
}
