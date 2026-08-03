import { checkWahaSession } from './session-monitor';

export async function handler() {
  await checkWahaSession();
}
