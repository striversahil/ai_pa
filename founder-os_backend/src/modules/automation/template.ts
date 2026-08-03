/**
 * Template interpolation for automation actions and conditions.
 * Supports `{{config.x}}`, `{{payload.x}}`, `{{record.x}}` and bare `{{x}}`
 * (resolved against the subject: event payload or scan record).
 */
import type { AutomationContext } from './types';

export function resolvePath(obj: any, path: string): any {
  if (!path) return undefined;
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export function renderTemplate(template: string, ctx: AutomationContext): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const [scope, ...rest] = path.split('.');
    let base: any;
    if (scope === 'config') base = ctx.config;
    else if (scope === 'payload') base = ctx.payload;
    else if (scope === 'record') base = ctx.record;
    else base = ctx.subject;

    const val = scope === 'config' || scope === 'payload' || scope === 'record'
      ? resolvePath(base, rest.join('.'))
      : resolvePath(ctx.subject, path);

    if (val == null) return '';
    return String(val);
  });
}
