import { Request, Response, NextFunction } from 'express';
import { logger } from '../shared/logger';

export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';
  logger.error({ error: err.stack || err.message, method: req.method, url: req.url }, 'Unhandled error');
  if (statusCode === 429) {
    res.status(429).json({ error: 'Rate limit reached', message: 'LLM rate limit reached. Please try again in a few minutes.' });
    return;
  }
  res.status(statusCode).json({ error: message });
}
