import { Request, Response } from 'express';
import { logger } from './logger';

export let sseClients: Response[] = [];

export function handleSSEConnection(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.push(res);
  logger.info({ clientCount: sseClients.length }, 'New SSE client connected');
  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
    logger.info({ clientCount: sseClients.length }, 'SSE client disconnected');
  });
}

export function broadcastWhatsAppEvent(event: string, data: any) {
  const payload = `data: ${JSON.stringify({ event, data })}\n\n`;
  sseClients.forEach(client => {
    try { client.write(payload); } catch (e: any) { logger.error('Failed to write to SSE client connection'); }
  });
}
