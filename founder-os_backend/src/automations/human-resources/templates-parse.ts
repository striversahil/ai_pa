import { HrError } from './errors';
import { cleanSalaryComponents } from './employees-parse';
import { nullableText, oneOf, positiveAmount, text } from './parse';
import { SALARY_INPUT_MODES, type SalaryPlanInput, type SalaryTemplateInput } from './types';

export function cleanSalaryTemplate(input: Record<string, any>): SalaryTemplateInput {
  const name = text(input.name, 120);
  if (!name) throw new HrError('template name is required');
  const inputMode = oneOf(input.inputMode ?? 'gross', SALARY_INPUT_MODES, 'inputMode');
  const components = cleanSalaryComponents(input.components, inputMode);
  return {
    name,
    description: nullableText(input.description, 500),
    inputMode,
    isDefault: Boolean(input.isDefault),
    components,
  };
}

export function cleanSalaryPlan(input: Record<string, any>, inputMode: string): SalaryPlanInput {
  const templateId = text(input.templateId, 100);
  if (!templateId) throw new HrError('templateId is required');
  const inputAmount = positiveAmount(input.inputAmount);
  const mode = oneOf(inputMode, SALARY_INPUT_MODES, 'inputMode');
  const components = input.components === undefined
    ? undefined
    : cleanSalaryComponents(input.components, mode);
  return { templateId, inputAmount, components };
}
