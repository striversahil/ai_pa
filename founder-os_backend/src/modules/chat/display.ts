// Chat display helpers. The chat stores persist auth_user ids; this module
// resolves those ids to HR display names (Character Name (Employee Name)) and
// exposes the root ids so every chat surface can hide the root account.
//
// Root is never a chat participant: it is filtered from user/member pickers,
// DMs and channels, and root-authored rows are dropped on read as defence.
import {
  buildDisplayNameIndex,
  displayNameForAuthUser,
  labelKey,
  type AuthNameFields,
  type EmployeeEmailFields,
} from '../../shared/employee-name';

export interface ChatNameLookup {
  byId: Map<string, string>;
  /** Auth names / HR names / emails -> display name (legacy rows without senderId). */
  byLabel: Map<string, string>;
  rootIds: Set<string>;
}

export function buildChatNameLookup(users: any[], employees: any[]): ChatNameLookup {
  const index = buildDisplayNameIndex(
    employees as EmployeeEmailFields[],
    users as AuthNameFields[],
  );
  const byId = new Map<string, string>();
  const rootIds = new Set<string>();
  for (const user of users) {
    const id = String(user?.id ?? '');
    if (!id) continue;
    if (Number(user?.isRoot ?? 0) === 1) rootIds.add(id);
    byId.set(id, displayNameForAuthUser(index, user));
  }
  return { byId, byLabel: index.byLabel, rootIds };
}

/** D1 variant used by the Worker store and route (no Prisma dependency). */
export async function loadD1ChatNameLookup(db: any): Promise<ChatNameLookup> {
  let users: any[] = [];
  let employees: any[] = [];
  try {
    const res = await db.prepare('SELECT id, name, email, displayName, isRoot FROM auth_user').all();
    users = (res?.results ?? []) as any[];
  } catch { /* older local DB without displayName/isRoot */ }
  try {
    const res = await db
      .prepare('SELECT name, characterName, useCharacterName, email, loginEmail FROM HumanResourcesMember WHERE deleted = 0')
      .all();
    employees = (res?.results ?? []) as any[];
  } catch { /* table may not exist in a minimal chat test DB */ }
  return buildChatNameLookup(users, employees);
}

export function presentChatMessage(message: any, names: ChatNameLookup): any {
  if (!message) return message;
  const replyTo = message.replyTo
    ? {
      ...message.replyTo,
      senderName: message.replyTo.senderId
        ? names.byId.get(String(message.replyTo.senderId))
          ?? names.byLabel.get(labelKey(message.replyTo.senderName))
          ?? message.replyTo.senderName
        : names.byLabel.get(labelKey(message.replyTo.senderName)) ?? message.replyTo.senderName,
    }
    : null;
  return {
    ...message,
    senderName: names.byId.get(String(message.senderId)) ?? names.byLabel.get(labelKey(message.senderName)) ?? message.senderName,
    replyTo,
  };
}

export function isRootId(names: ChatNameLookup, id: unknown): boolean {
  return names.rootIds.has(String(id ?? ''));
}
