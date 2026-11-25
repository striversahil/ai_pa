// Canonical employee display-name rules.
//
// The HR register's `name` is the legal/statutory name and is NEVER replaced.
// A member may opt into a character/working name; every display surface then
// renders "Character Name (Legal Name)".
//
// Frontend mirror: founder-os_frontend/src/hr/display.ts (keep in lockstep).
// Guard: scripts/guards/employee-display-name.test.mjs

export interface EmployeeNameFields {
  name?: string | null;
  characterName?: string | null;
  useCharacterName?: boolean | null;
}

/** Trim + collapse whitespace; returns "" for null/blank. */
export function cleanDisplayName(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * "Iron Man (Rahul Singh)" when enabled and present, otherwise the legal name.
 * Consecutive-duplicate names (same text) collapse to one copy.
 */
export function employeeDisplayName(member: EmployeeNameFields | null | undefined): string {
  if (!member) return "";
  const legal = cleanDisplayName(member.name);
  const character = cleanDisplayName(member.characterName);
  if (!member.useCharacterName || !character) return legal;
  if (!legal) return character;
  if (character.toLowerCase() === legal.toLowerCase()) return legal;
  return `${character} (${legal})`;
}

/** Split a multi-address HR cell into normalized email tokens. */
export function employeeEmailTokens(value: unknown): string[] {
  return String(value ?? "")
    .split(/[,;\s]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.includes("@"));
}

/**
 * Email -> employee. `loginEmail` wins over the contact `email` cell, because
 * the login link is explicit and the contact cell may hold shared addresses.
 */
export function buildEmployeeNameIndex(rows: EmployeeEmailFields[]): Map<string, EmployeeNameFields> {
  const index = new Map<string, EmployeeNameFields>();
  const add = (email: unknown, row: EmployeeEmailFields) => {
    for (const token of employeeEmailTokens(email)) {
      if (!index.has(token)) index.set(token, row);
    }
  };
  for (const row of rows) add(row.loginEmail, row);
  for (const row of rows) {
    add(row.email, row);
    // A login email is often also the contact email; do not lose it if the
    // contact cell is blank.
    if (!row.email) add(row.loginEmail, row);
  }
  return index;
}

export function displayNameForEmail(
  index: Map<string, EmployeeNameFields>,
  email: unknown,
  fallback: string | null | undefined,
): string {
  const token = String(email ?? "").trim().toLowerCase();
  const hit = token ? index.get(token) : undefined;
  return hit ? employeeDisplayName(hit) : cleanDisplayName(fallback);
}

export interface EmployeeEmailFields extends EmployeeNameFields {
  email?: string | null;
  loginEmail?: string | null;
}

export interface AuthNameFields {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  displayName?: string | null;
}

export interface DisplayNameIndex {
  byEmail: Map<string, string>;
  byLabel: Map<string, string>;
  byAuthId: Map<string, string>;
}

/** Lowercase/collapse for free-text audit labels. */
export function labelKey(value: unknown): string {
  return cleanDisplayName(value).toLowerCase();
}

/**
 * One index for chat, leave audit labels, task logs and any other surface that
 * stores a person's login name. HR-linked emails always resolve to the current
 * character-name format; auth-only accounts fall back to their display
 * override, then their login name.
 */
export function buildDisplayNameIndex(
  employees: EmployeeEmailFields[],
  authUsers: AuthNameFields[] = [],
): DisplayNameIndex {
  const byEmail = new Map<string, string>();
  const byLabel = new Map<string, string>();
  const byAuthId = new Map<string, string>();
  const addEmail = (email: unknown, display: string) => {
    for (const token of employeeEmailTokens(email)) {
      if (display && !byEmail.has(token)) byEmail.set(token, display);
    }
  };
  const addLabel = (label: unknown, display: string) => {
    const key = labelKey(label);
    if (key && display && !byLabel.has(key)) byLabel.set(key, display);
  };

  // Login emails first, then contact emails.
  for (const row of employees) {
    const display = employeeDisplayName(row);
    if (!display) continue;
    addEmail(row.loginEmail, display);
    addLabel(row.name, display);
    addLabel(row.characterName, display);
    addLabel(row.loginEmail, display);
  }
  for (const row of employees) {
    const display = employeeDisplayName(row);
    if (!display) continue;
    addEmail(row.email, display);
    addLabel(row.email, display);
  }

  for (const user of authUsers) {
    const email = String(user.email ?? "").trim().toLowerCase();
    const fallback = cleanDisplayName(user.displayName) || cleanDisplayName(user.name);
    const display = (email && byEmail.get(email)) || fallback;
    if (user.id && display) byAuthId.set(String(user.id), display);
    addLabel(user.name, display);
    addLabel(user.displayName, display);
    addEmail(email, display);
  }
  return { byEmail, byLabel, byAuthId };
}

export function displayNameForEmailInIndex(
  index: DisplayNameIndex,
  email: unknown,
  fallback: string | null | undefined,
): string {
  const token = String(email ?? "").trim().toLowerCase();
  return (token && index.byEmail.get(token)) || cleanDisplayName(fallback);
}

export function displayNameForLabel(
  index: DisplayNameIndex,
  label: unknown,
  fallback?: string | null,
): string {
  const key = labelKey(label);
  return (key && index.byLabel.get(key)) || cleanDisplayName(fallback ?? label);
}

export function displayNameForAuthUser(
  index: DisplayNameIndex,
  user: AuthNameFields,
): string {
  const id = String(user.id ?? "");
  if (id && index.byAuthId.has(id)) return index.byAuthId.get(id) as string;
  return displayNameForEmailInIndex(index, user.email, user.displayName || user.name);
}
