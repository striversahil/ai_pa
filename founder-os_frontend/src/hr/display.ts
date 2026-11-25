// Frontend mirror of founder-os_backend/src/shared/employee-name.ts.
// Keep the format and duplicate-collapse semantics byte-identical.
// Guard: scripts/guards/employee-display-name.test.mjs
// mirror: founder-os_backend/src/shared/employee-name.ts

export interface EmployeeNameFields {
  name?: string | null;
  characterName?: string | null;
  useCharacterName?: boolean | null;
}

export function cleanDisplayName(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function employeeDisplayName(member: EmployeeNameFields | null | undefined): string {
  if (!member) return "";
  const legal = cleanDisplayName(member.name);
  const character = cleanDisplayName(member.characterName);
  if (!member.useCharacterName || !character) return legal;
  if (!legal) return character;
  if (character.toLowerCase() === legal.toLowerCase()) return legal;
  return `${character} (${legal})`;
}
