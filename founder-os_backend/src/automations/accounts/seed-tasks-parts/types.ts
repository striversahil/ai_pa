// Extracted verbatim from seed-tasks.ts by scripts/refactor/split-module.mjs.
// seed-tasks.ts re-exports everything public here, so existing imports keep working.


export interface AccountsSeedTask {
  id: string;
  title: string;
  description: string | null;
  frequency: string;
  ownerRole: string;
  dueDay: number | null;
  dueMonth: number | null;
  ruleType: string;
  ruleJson: string;
  rawText: string | null;
  isShared: boolean;
  employeeRaw: string | null;
  department: string | null;
  sheetStatus: string | null;
  active: boolean;
  order: number;
}
