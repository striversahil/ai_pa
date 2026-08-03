import { generateAndSaveEveningSummary } from './service';

export async function handler() {
  await generateAndSaveEveningSummary();
}
