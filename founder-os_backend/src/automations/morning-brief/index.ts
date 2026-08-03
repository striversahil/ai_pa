import { generateAndSaveMorningBrief } from './service';

export async function handler() {
  await generateAndSaveMorningBrief();
}
