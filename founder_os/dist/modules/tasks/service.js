"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TasksService = void 0;
const repository_1 = require("../storage/repository");
const logger_1 = require("../../shared/logger");
class TasksService {
    /**
     * Creates a new task
     */
    static async createTask(data) {
        logger_1.logger.debug({ title: data.title, owner: data.owner }, 'TasksService: creating task');
        return repository_1.StorageRepository.createTask(data);
    }
    /**
     * Retrieves all tasks
     */
    static async fetchTasks() {
        logger_1.logger.debug('TasksService: fetching all tasks');
        return repository_1.StorageRepository.fetchTasks();
    }
}
exports.TasksService = TasksService;
exports.default = TasksService;
