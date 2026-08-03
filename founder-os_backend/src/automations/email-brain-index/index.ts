import { EmailEngine } from '../../modules/email/engine';
import { BrainService } from '../../modules/brain/service';

export async function handler() {
  await new EmailEngine().runSync();
  await new BrainService().runSync();
}
