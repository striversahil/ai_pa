import { SLAChecker } from './sla-check';

export async function handler() {
  await SLAChecker.check();
}
