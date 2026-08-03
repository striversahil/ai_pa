import { processMessagesToDigests } from './process';

export async function handler() {
  await processMessagesToDigests();
}
