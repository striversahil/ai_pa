import { StorageRepository } from '../storage/repository';
import { logger } from '../../shared/logger';

export class TasksService {
  /**
   * Creates a new task
   */
  static async createTask(data: {
    title: string;
    owner: string;
    status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    deadline?: Date | null;
    source: string;
    sourceId?: string | null;
  }) {
    logger.debug({ title: data.title, owner: data.owner }, 'TasksService: creating task');
    return StorageRepository.createTask(data);
  }

  /**
   * Retrieves all tasks
   */
  static async fetchTasks() {
    logger.debug('TasksService: fetching all tasks');
    return StorageRepository.fetchTasks();
  }
}
export default TasksService;
