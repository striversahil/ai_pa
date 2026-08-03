/**
 * Optional custom logic for this automation.
 *
 * Everything in this file is OPTIONAL — a purely declarative rule automation can
 * delete it. Pick whichever exports your automation needs:
 *
 *   handler   — Flavor 2 (handler automation): the code body that runs per trigger
 *   scanner   — rule automation with a schedule: returns candidate records to evaluate
 *   dedupKey  — custom dedup key (defaults to `dedupField` from rule.json)
 *   actions   — custom actions referenced from rule.json as { "type": "custom:<key>" }
 *   data      — dashboard data provider (GET /api/automations/:slug/data)
 *
 * Import paths: automations live in src/automations/<slug>/ and the framework
 * lives in src/modules/automation/. Adjust the relative path if you move this.
 */
import type { AutomationContext, ScanRecord } from '../../modules/automation/types';

// --- Flavor 2: handler automation (scheduled code body) ---
// export async function handler(ctx: AutomationContext) {
//   // const result = await SomeExistingService.run();
//   // ctx.log('info', 'ran', { result });
// }

// --- Flavor 1: scheduled rule automation — candidate records ---
// export async function scanner(ctx: AutomationContext): Promise<ScanRecord[]> {
//   // e.g. pull unprocessed inbound messages from a chat
//   // const rows = await prisma.message.findMany({ where: { chatId: ctx.config.sourceChatId } });
//   return [];
// }

// --- Custom dedup key (defaults to `dedupField` in rule.json) ---
// export function dedupKey(subject: Record<string, any>): string {
//   return String(subject.id ?? 'fallback');
// }

// --- Custom actions: { "type": "custom:myAction" } ---
// export const actions = {
//   async myAction(ctx: AutomationContext) {
//     // const { chatId, body } = ctx.subject;
//   },
// };
