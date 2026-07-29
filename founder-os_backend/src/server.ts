import express from 'express';
import path from 'path';
import { config } from './config';
import { logger } from './shared/logger';
import { checkDatabaseConnection } from './shared/prisma';
import { SchedulerService } from './modules/scheduler/service';
import { errorHandler } from './middleware/errorHandler';
import routes, { whatsappWebhookRouter } from './routes';
import { handleSSEConnection } from './shared/sse';

const app = express();

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  logger.info({ method: req.method, url: req.url }, 'Incoming API Request');
  next();
});

// WhatsApp webhook (before main routes to avoid json parsing issues)
app.use('/api/whatsapp/webhook', whatsappWebhookRouter);

// SSE events endpoint
app.get('/api/whatsapp/events', handleSSEConnection);

// All REST API routes
app.use('/api', routes);

// Error handler (must be last)
app.use(errorHandler);

async function startServer() {
  await checkDatabaseConnection();
  const port = config.PORT;
  app.listen(port, () => {
    logger.info(`Founder Assistant OS Server running on http://localhost:${port} in ${config.NODE_ENV} mode`);
    SchedulerService.init();
  });
}

startServer().catch((err) => {
  logger.fatal({ error: err.message }, 'Failed to start Express server');
  process.exit(1);
});

export default app;