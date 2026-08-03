import { MessageQueueService } from '../../modules/queue/service';

export async function handler() {
  await MessageQueueService.recoverOutboundIntents();
}
