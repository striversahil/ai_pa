import { logger } from './logger';

type SseClient = { id: number; enqueue: (chunk: string) => void; closed: () => void };

let nextId = 1;
const clients = new Set<SseClient>();

export function handleSSEConnection(): { stream: ReadableStream; cleanup: () => void } {
  const id = nextId++;
  const client: SseClient = {
    id,
    enqueue: () => {},
    closed: () => {},
  };
  let cleanup = () => {};
  let controller: ReadableStreamDefaultController | null = null;
  const stream = new ReadableStream({
    start(c) {
      controller = c;
      client.enqueue = (chunk: string) => {
        try {
          c.enqueue(chunk);
        } catch {
          /* stream closed */
        }
      };
      c.enqueue(`data: ${JSON.stringify({ event: 'connected' })}\n\n`);
      clients.add(client);
      logger.info({ clientCount: clients.size }, 'New SSE client connected');
    },
    cancel() {
      clients.delete(client);
      cleanup();
      logger.info({ clientCount: clients.size }, 'SSE client disconnected');
    },
  });
  cleanup = () => {};
  return { stream, cleanup };
}

export function broadcastWhatsAppEvent(event: string, data: any) {
  const payload = `data: ${JSON.stringify({ event, data })}\n\n`;
  for (const client of clients) {
    try { client.enqueue(payload); } catch (e: any) { logger.error('Failed to write to SSE client connection'); }
  }
}