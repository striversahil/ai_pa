import { NotificationBatcher } from './batcher';

export async function handler() {
  await NotificationBatcher.flushAll();
}
