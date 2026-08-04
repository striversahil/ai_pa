/**
 * Action bus. Every action type maps to an existing service — automations can
 * never bypass the anti-ban outbound pipeline, the allowlist (unless explicitly
 * allowed), or the rate limits.
 */
import { logger } from '../../shared/logger';
import { StorageRepository } from '../storage/repository';
import { OutboundService, SendResult } from '../whatsapp/outbound';
import { NotificationBatcher } from '../../automations/notification-batcher/batcher';
import { TasksService } from '../tasks/service';
import { AIService } from '../ai/service';
import type { ActionSpec, AutomationContext, AutomationModule } from './types';
import { renderTemplate } from './template';

export type ActionResult = { status: string; detail?: string };

async function whatsappSend(spec: ActionSpec, ctx: AutomationContext): Promise<ActionResult> {
  const chatId = renderTemplate(String(spec.chatId ?? ''), ctx);
  const body = renderTemplate(String(spec.body ?? ''), ctx);
  const allowNonAllowlisted = spec.allowNonAllowlisted === true;

  if (!chatId || !body) {
    ctx.log('warn', 'whatsapp_send skipped: chatId/body empty after templating', { chatId, body });
    return { status: 'skipped', detail: 'empty template' };
  }

  const allowlisted = await StorageRepository.hasInboundMessages(chatId);
  if (!allowlisted && !allowNonAllowlisted) {
    ctx.log('warn', 'whatsapp_send skipped: chat not allowlisted', { chatId });
    return { status: 'skipped', detail: 'not_allowlisted' };
  }

  const result: SendResult = await OutboundService.sendWithJitter(chatId, body);
  ctx.log('info', 'whatsapp_send executed', { chatId, result, allowNonAllowlisted });
  return { status: result };
}

async function createTask(spec: ActionSpec, ctx: AutomationContext): Promise<ActionResult> {
  const title = renderTemplate(String(spec.title ?? ''), ctx);
  const owner = renderTemplate(String(spec.owner ?? 'Founder'), ctx);
  const source = renderTemplate(String(spec.source ?? 'AUTOMATION'), ctx);
  const task = await TasksService.createTask({
    title,
    owner,
    source,
    sourceId: spec.sourceId ? renderTemplate(String(spec.sourceId), ctx) : null,
  });
  ctx.log('info', 'create_task executed', { taskId: task?.id, title });
  return { status: 'success' };
}

async function notify(spec: ActionSpec, ctx: AutomationContext): Promise<ActionResult> {
  const chatId = renderTemplate(String(spec.chatId ?? ''), ctx);
  const message = renderTemplate(String(spec.message ?? ''), ctx);
  NotificationBatcher.addAlert(chatId, message);
  ctx.log('info', 'notify buffered', { chatId });
  return { status: 'buffered' };
}

async function sheetsUpdate(spec: ActionSpec): Promise<ActionResult> {
  // GoogleSheetsService currently only exposes reads; wire the write method
  // when the sheets integration lands. Logged honestly rather than silently.
  logger.warn({ type: 'sheets_update' }, 'sheets_update action: not wired yet');
  return { status: 'unsupported' };
}

async function zohoUpdate(spec: ActionSpec): Promise<ActionResult> {
  logger.warn({ type: 'zoho_update' }, 'zoho_update action: not wired yet');
  return { status: 'unsupported' };
}

async function emailSend(spec: ActionSpec): Promise<ActionResult> {
  logger.warn({ type: 'email_send' }, 'email_send action: not wired yet (EmailService has no send method)');
  return { status: 'unsupported' };
}

/**
 * Curated AIService methods callable from declarative rule.json actions.
 * Each adapter maps the action's `args` object onto the method signature.
 */
type AiAdapter = (args: Record<string, unknown>, ctx: AutomationContext) => Promise<unknown>;

function str(v: unknown, fallback = ''): string {
  return v == null ? fallback : String(v);
}

const AI_ADAPTERS: Record<string, AiAdapter> = {
  classifyMessage: (a) => AIService.classifyMessage({
    sender: str(a.sender),
    body: str(a.body),
    timestamp: str(a.timestamp, new Date().toISOString()),
    conversationContext: str(a.conversationContext),
  }),
  summarizeConversation: async (a) => {
    const messages = Array.isArray(a.messages) ? a.messages : [];
    return AIService.summarizeConversation(str(a.chatName), messages as any[]);
  },
  extractEnquiry: (a) => AIService.extractEnquiryAndDate(str(a.commentsHistory ?? a.comments)),
  classifyEstimateComments: (a) => AIService.classifyEstimateComments(
    str(a.customerName),
    Number(a.total ?? 0),
    str(a.commentsHistory ?? a.comments),
    str(a.estimateDate, new Date().toISOString().split('T')[0]),
  ),
  queryBrain: (a) => AIService.queryBrain(str(a.question), str(a.contextText ?? a.context)),
  answerFounderQuestion: (a) => AIService.answerFounderQuestion(str(a.question), {
    digests: str(a.digests),
    tasks: str(a.tasks),
    metadata: str(a.metadata),
  }),
};

/**
 * Renders an arg value: runs template interpolation, then parses structured
 * JSON (`{...}` / `[...]`) so automations can pass objects/arrays declaratively.
 */
function renderArg(raw: unknown, ctx: AutomationContext): unknown {
  if (typeof raw !== 'string') return raw;
  const rendered = renderTemplate(raw, ctx);
  const trimmed = rendered.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return rendered;
    }
  }
  return rendered;
}

/**
 * ai_analyze — built-in AI action for declarative rule automations.
 *
 * spec: { type: 'ai_analyze', method, args, as?, onError? }
 *   method  one of AI_ADAPTERS (classifyMessage, summarizeConversation, ...)
 *   args    object of arguments, values templated (`{{payload.x}}`, `{{config.x}}`)
 *   as      optional namespace; result stored at ctx.ai[as] → `{{ai.<as>.<field>}}`
 *           (default: merged into ctx.ai → `{{ai.<field>}}`; string results → `{{ai.result}}`)
 *   onError 'fail' (default: run FAILED) | 'skip' (run still succeeds without result)
 */
async function aiAnalyze(spec: ActionSpec, ctx: AutomationContext): Promise<ActionResult> {
  const method = str(spec.method);
  const adapter = AI_ADAPTERS[method];
  if (!adapter) {
    ctx.log('warn', `ai_analyze: unknown method "${method}"`);
    return { status: 'skipped', detail: `unknown_method:${method}` };
  }

  const rawArgs = (spec.args && typeof spec.args === 'object' ? spec.args : {}) as Record<string, unknown>;
  const args: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawArgs)) args[k] = renderArg(v, ctx);

  let result: unknown;
  try {
    result = await adapter(args, ctx);
  } catch (e: any) {
    ctx.log('error', `ai_analyze: ${method} failed`, { error: e?.message });
    if (str(spec.onError) === 'skip') return { status: 'skipped', detail: 'ai_error' };
    throw e;
  }

  const ns = str(spec.as || '').trim();
  const normalized = result && typeof result === 'object' ? result : { result };
  ctx.ai = ns
    ? { ...(ctx.ai ?? {}), [ns]: normalized }
    : { ...(ctx.ai ?? {}), ...(normalized as Record<string, any>) };

  ctx.log('info', `ai_analyze executed`, { method, storedUnder: ns ? `ai.${ns}` : 'ai' });
  return { status: 'success' };
}

const BUILTIN_ACTIONS: Record<string, (spec: ActionSpec, ctx: AutomationContext) => Promise<ActionResult>> = {
  whatsapp_send: whatsappSend,
  create_task: createTask,
  notify,
  ai_analyze: aiAnalyze,
  sheets_update: sheetsUpdate,
  zoho_update: zohoUpdate,
  email_send: emailSend,
};

/**
 * Executes one action spec. Custom actions (`custom:<key>`) come from the
 * automation's own index.ts `actions` map.
 */
export async function executeAction(
  spec: ActionSpec,
  ctx: AutomationContext,
  module: AutomationModule | undefined
): Promise<ActionResult> {
  const type = spec.type;
  if (type.startsWith('custom:')) {
    const key = type.slice('custom:'.length);
    const fn = module?.actions?.[key];
    if (!fn) {
      ctx.log('warn', `custom:${key} not found in automation index.ts`);
      return { status: 'skipped', detail: 'custom_action_missing' };
    }
    await fn(ctx);
    ctx.log('info', `custom:${key} executed`);
    return { status: 'success' };
  }
  const fn = BUILTIN_ACTIONS[type];
  if (!fn) {
    ctx.log('warn', `unknown action type: ${type}`);
    return { status: 'skipped', detail: 'unknown_action' };
  }
  return fn(spec, ctx);
}
