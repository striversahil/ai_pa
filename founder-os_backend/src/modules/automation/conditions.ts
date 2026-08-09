/**
 * JSON condition DSL evaluator.
 *
 * Conditions are nested JSON: { all: [...] } | { any: [...] } | { not: {...} }
 * or a single comparison { field, op, value }. `field` is a dot-path resolved
 * against the subject (event payload or scan record).
 *
 * Operators: eq, neq, gt, gte, lt, lte, contains, in, notIn, exists,
 * olderThan, youngerThan.
 */
import type { AutomationContext, ConditionNode } from './types';
import { renderTemplate, resolvePath } from './template';

function toDate(value: any): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Parse durations like "3d", "5h", "10m", "30s" (or raw ms number) into ms. */
export function parseDuration(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return 0;
  const m = value.trim().match(/^(\d+)\s*(ms|s|m|h|d)?$/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  const unit = (m[2] || 'ms').toLowerCase();
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (multipliers[unit] ?? 1);
}

function compare(node: ConditionNode, subject: any, ctx?: AutomationContext): boolean {
  if (node.all) return node.all.every((n) => compare(n, subject, ctx));
  if (node.any) return node.any.some((n) => compare(n, subject, ctx));
  if (node.not) return !compare(node.not, subject, ctx);

  if (!node.field || !node.op) return true;
  const actual = resolvePath(subject, node.field);
  // Condition values support {{config.x}} templating so rules can reference
  // their own runtime-editable config without code changes.
  let expected = node.value;
  if (typeof expected === 'string' && expected.includes('{{') && ctx) {
    expected = renderTemplate(expected, ctx);
  }

  switch (node.op) {
    case 'eq': return actual === expected;
    case 'neq': return actual !== expected;
    case 'gt': return actual != null && expected != null && Number(actual) > Number(expected);
    case 'gte': return actual != null && expected != null && Number(actual) >= Number(expected);
    case 'lt': return actual != null && expected != null && Number(actual) < Number(expected);
    case 'lte': return actual != null && expected != null && Number(actual) <= Number(expected);
    case 'contains':
      if (Array.isArray(actual)) return actual.includes(expected);
      if (typeof actual === 'string') return actual.toLowerCase().includes(String(expected).toLowerCase());
      return false;
    case 'in': return Array.isArray(expected) && expected.includes(actual);
    case 'notIn': return Array.isArray(expected) && !expected.includes(actual);
    case 'exists': return actual != null;
    case 'olderThan': {
      const date = toDate(actual);
      return date != null && Date.now() - date.getTime() > parseDuration(expected);
    }
    case 'youngerThan': {
      const date = toDate(actual);
      return date != null && Date.now() - date.getTime() < parseDuration(expected);
    }
    default: return true;
  }
}

export function evaluateCondition(node: ConditionNode | null | undefined, subject: any, ctx?: AutomationContext): boolean {
  if (!node) return true;
  return compare(node, subject, ctx);
}
