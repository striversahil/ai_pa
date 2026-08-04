/**
 * Shared types for the automation framework.
 *
 * One automation = one folder in src/automations/<slug>/ with a README.md
 * (required), a rule.json (declarative definition) and an optional index.ts
 * (custom handler / scanner / dedupKey / actions / data provider).
 */

export type AutomationType = 'rule' | 'handler';

export type TriggerType = 'event' | 'schedule' | 'event_plus_scan';

export interface AutomationTrigger {
  type: TriggerType;
  /** Required when type is 'event' or 'event_plus_scan'. */
  event?: string;
  /**
   * Required when type is 'schedule' (string or array of node-cron strings).
   * For 'event_plus_scan' this is unused; use `fallbackCron` instead.
   */
  cron?: string | string[];
  /**
   * 'event_plus_scan' only: periodic scan fallback so a missed event (backend
   * down, race at boot) is still caught within this interval.
   */
  fallbackCron?: string;
}

export interface ConditionNode {
  all?: ConditionNode[];
  any?: ConditionNode[];
  not?: ConditionNode;
  field?: string;
  op?: string;
  value?: unknown;
}

export interface ActionSpec {
  type: string; // 'whatsapp_send' | 'create_task' | 'notify' | 'ai_analyze' | 'sheets_update' | 'zoho_update' | 'email_send' | 'custom:<key>'
  [key: string]: unknown;
}

export interface AutomationDefinition {
  /** Equal to the folder slug. */
  id: string;
  name: string;
  description?: string;
  type: AutomationType;
  trigger: AutomationTrigger;
  condition?: ConditionNode | null;
  /** Dot-path into the subject (payload or scan record) that identifies it uniquely. */
  dedupField?: string;
  actions?: ActionSpec[];
  config?: Record<string, unknown>;
  cooldownMs?: number;
  enabled?: boolean;
}

/**
 * Context passed to handlers, scanners, custom actions and conditions.
 * `subject` is the payload (event) or scan record; `payload`/`record` alias it
 * for template rendering (`{{payload.x}}`, `{{record.x}}`, `{{config.x}}`).
 * `ai` is written by the built-in `ai_analyze` action so later actions can
 * reference its result (`{{ai.<field>}}`, or `{{ai.<as>.<field>}}` when a
 * namespace `as` is set).
 */
export interface AutomationContext {
  subject: Record<string, any>;
  payload?: Record<string, any>;
  record?: Record<string, any>;
  config: Record<string, any>;
  ai?: Record<string, any>;
  log: (level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>) => void;
}

export interface ScanRecord {
  [key: string]: any;
}

/**
 * Optional exports from an automation's index.ts.
 */
export interface AutomationModule {
  /** Handler automations: the code body that runs on each trigger. */
  handler?: (ctx: AutomationContext) => Promise<void>;
  /** Rule automations with a schedule/fallback: returns candidate records. */
  scanner?: (ctx: AutomationContext) => Promise<ScanRecord[]>;
  /** Custom dedup key (defaults to `dedupField` from rule.json). */
  dedupKey?: (subject: Record<string, any>) => string;
  /** Custom actions referenced from rule.json as `custom:<key>`. */
  actions?: Record<string, (ctx: AutomationContext) => Promise<void>>;
  /** Optional dashboard data provider (`GET /api/automations/:slug/data`). */
  data?: (ctx: AutomationContext) => Promise<any>;
}
