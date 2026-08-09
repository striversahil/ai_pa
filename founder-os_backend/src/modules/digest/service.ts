import { StorageRepository } from '../storage/repository';
import { logger } from '../../shared/logger';

export class DigestService {
  /**
   * Retrieve all generated digests (platform read API for /api/digests).
   * The digest *processing* job now lives in src/automations/whatsapp-digest/.
   */
  static async fetchAllDigests() {
    logger.debug('DigestService: fetching all digests');
    return StorageRepository.fetchDigests();
  }
}
export default DigestService;
