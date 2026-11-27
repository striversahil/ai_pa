// roster.ts — NeoDove identity sync (link-only).
//
// Since mig 0177 the sales roster IS the HR register: there is no roster row to
// create. This sync may only FILL an empty NeoDove link on an existing sales
// employee whose name identifies exactly one unlinked person — ambiguous or
// unknown agents are left for the sales head to hand-link in the person drawer.
// It never creates an employee, so a NeoDove user can never become a "roster
// row without an employee record".
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { getAllNeodoveAgents } from '../neodove-telecaller-report';

async function syncTelecallersFromNeodove(): Promise<void> {
  try {
    const agents = await getAllNeodoveAgents();
    if (agents.length === 0) return;

    const staff = (await prisma.humanResourcesMember.findMany({ where: { deleted: false } })) as any[];
    const sales = staff.filter((m) => String(m.salesType ?? '') !== '');
    if (sales.length === 0) return;

    // Names that already carry a link (NeoDove-side, case-insensitive) are done.
    const linked = new Set(
      sales.map((m) => String(m.neodoveUserName ?? '').toLowerCase().trim()).filter(Boolean),
    );
    // Unlinked staff by every name NeoDove might use (legal + character name).
    const byName = new Map<string, any[]>();
    for (const m of sales) {
      if (m.neodoveUserId || m.neodoveUserName) continue;
      for (const name of [m.name, m.characterName]) {
        const key = String(name ?? '').toLowerCase().trim();
        if (!key) continue;
        const list = byName.get(key) ?? [];
        if (!list.includes(m)) list.push(m);
        byName.set(key, list);
      }
    }

    let filled = 0;
    for (const a of agents) {
      const userName = String((a as any).userName ?? '').trim();
      if (!userName || linked.has(userName.toLowerCase())) continue;
      const candidates = (byName.get(userName.toLowerCase()) ?? []).filter(
        (m) => !m.neodoveUserId && !m.neodoveUserName,
      );
      // Exactly one candidate, or nothing: never guess between two people.
      if (candidates.length !== 1) continue;
      const member = candidates[0];
      await prisma.humanResourcesMember.update({
        where: { id: member.id },
        data: {
          neodoveUserId: (a as any).userId || null,
          neodoveUserName: userName,
        },
      });
      member.neodoveUserId = (a as any).userId || null;
      member.neodoveUserName = userName;
      linked.add(userName.toLowerCase());
      filled++;
    }
    if (filled > 0) {
      logger.info({ agents: agents.length, filled }, 'Linked NeoDove agents to existing sales staff');
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'syncTelecallersFromNeodove failed');
  }
}

export { syncTelecallersFromNeodove };
