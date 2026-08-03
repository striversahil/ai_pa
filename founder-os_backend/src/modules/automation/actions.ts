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

const BUILTIN_ACTIONS: Record<string, (spec: ActionSpec, ctx: AutomationContext) => Promise<ActionResult>> = {
  whatsapp_send: whatsappSend,
  create_task: createTask,
  notify,
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
