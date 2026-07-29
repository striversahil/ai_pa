import { Router } from 'express';
import { TasksService } from '../modules/tasks/service';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const tasks = await TasksService.fetchTasks();
  res.status(200).json(tasks);
}));

export default router;
