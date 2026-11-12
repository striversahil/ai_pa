// modules/telecalling/self-roster.ts — signed-in user → Telecaller roster id.
//
// Moved verbatim from worker/routes/automations.ts#resolveSelfTelecaller so the
// lookup is reusable outside the Hono context (viewer + workspace scopers).
// Matching (pure) lives in ./self.ts#resolveRosterMatch:
//   1. exact email, 2. loose name prefix / unique short form, 3. null.
import { prisma } from '../../shared/prisma';
import { resolveRosterMatch } from './self';

export async function resolveSelfTelecallerId(me: any): Promise<string | null> {
  if (!me) return null;
  const tcs = await (prisma as any).telecaller.findMany({ where: { deleted: false } });
  if (tcs.length === 0) return null;
  const hit = resolveRosterMatch(tcs as any[], me as any);
  return hit ? String((hit as any).id) : null;
}
