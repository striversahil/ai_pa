import { Request, Response, NextFunction } from 'express';
import { logger } from '../shared/logger';

/**
 * Wrapper for async route handlers to eliminate try/catch boilerplate
 * and ensure errors are passed to Express error handler
 */
export const asyncHandler = 
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => 
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res, next);
    } catch (error) {
      logger.error({ error: (error as Error).message, stack: (error as Error)?.stack }, 'Async handler error');
      next(error);
    }
  };