import { Request, Response, NextFunction } from 'express';
import { logger } from '../shared/logger';

/**
 * Centralized error handling middleware
 * Formats error responses and logs errors appropriately
 */
export const errorHandler = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Log the error with context
  logger.error({
    error: error.message,
    stack: error.stack,
    method: req.method,
    url: req.url,
    body: req.body,
    query: req.query,
    params: req.params
  }, 'Unhandled error');

  // Determine status code
  const statusCode = error.statusCode || error.status || 500;
  
  // Don't leak error details in production
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal Server Error' 
    : error.message || 'Internal Server Error';

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
  });
};

/**
 * 404 handler for undefined routes
 */
export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.url} not found`
  });
};