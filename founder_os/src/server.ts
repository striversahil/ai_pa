import express from 'express';
import path from 'path';
import { config } from './config';
import { logger } from './shared/logger';
import { SchedulerService } from './modules/scheduler/service';
import { WhatsAppController } from './modules/whatsapp/controller';
import { WhatsAppService } from './modules/whatsapp/service';
import { DigestService } from './modules/digest/service';
import { TasksService } from './modules/tasks/service';
import { StorageRepository } from './modules/storage/repository';
import { AIService } from './modules/ai/service';
import { EmailService } from './modules/email/service';
import { checkDatabaseConnection, useInMemoryDb } from './shared/prisma';

const app = express();

// Serve the static frontend files
app.use(express.static(path.join(__dirname, '../public')));

app.use(express.json({ limit: '10mb' })); // Support larger payloads (like media Base64 from WhatsApp)

// Request logger middleware
app.use((req, res, next) => {
  logger.info({ method: req.method, url: req.url }, 'Incoming API Request');
  next();
});

// --- WhatsApp webhook endpoint ---
app.post('/api/whatsapp/webhook', WhatsAppController.handleWebhook);

// --- REST API Endpoints ---

/**
 * GET /api/status
 * Returns connection diagnostic status (Supabase active / LLM API key status)
 */
app.get('/api/status', (req, res) => {
  const isMockLLM = !config.LLM_API_KEY || config.LLM_API_KEY === 'your_api_key_here';
  res.status(200).json({
    success: true,
    useInMemoryDb,
    isMockLLM,
  });
});

/**
 * GET /api/brief/latest
 * Retrieve the latest generated founder briefing or EOD summary
 */
app.get('/api/brief/latest', async (req, res) => {
  try {
    const brief = await StorageRepository.fetchLatestFounderNote();
    if (!brief) {
      res.status(404).json({ error: 'No briefings found.' });
      return;
    }
    res.status(200).json(brief);
  } catch (error: any) {
    logger.error({ error: error.message }, 'API Error: GET /api/brief/latest');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/digests
 * Fetch conversation digests
 */
app.get('/api/digests', async (req, res) => {
  try {
    const digests = await DigestService.fetchAllDigests();
    res.status(200).json(digests);
  } catch (error: any) {
    logger.error({ error: error.message }, 'API Error: GET /api/digests');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/tasks
 * Fetch extracted action items
 */
app.get('/api/tasks', async (req, res) => {
  try {
    const tasks = await TasksService.fetchTasks();
    res.status(200).json(tasks);
  } catch (error: any) {
    logger.error({ error: error.message }, 'API Error: GET /api/tasks');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/messages/:chatId
 * Fetch raw messages from a specific WhatsApp chat
 */
app.get('/api/messages/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const messages = await WhatsAppService.fetchMessagesByChatId(chatId);
    res.status(200).json(messages);
  } catch (error: any) {
    logger.error({ error: error.message }, 'API Error: GET /api/messages/:chatId');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /api/ask-founder-ai
 * Direct query endpoint for the founder to interact with the AI assistant context
 */
app.post('/api/ask-founder-ai', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) {
      res.status(400).json({ error: 'Missing question in request body' });
      return;
    }

    // Gathers recent context
    const digests = await DigestService.fetchAllDigests();
    const tasks = await TasksService.fetchTasks();

    const digestsString = digests
      .slice(0, 10)
      .map((d) => `Chat: "${d.chatName}" (Priority: ${d.priority}) Summary: ${d.summary}`)
      .join('\n');

    const tasksString = tasks
      .filter((t) => t.status === 'PENDING')
      .map((t) => `Task: "${t.title}" | Owner: ${t.owner} | Source: ${t.source}`)
      .join('\n');

    const metadata = `Current Time: ${new Date().toISOString()}`;

    const answer = await AIService.answerFounderQuestion(question, {
      digests: digestsString,
      tasks: tasksString,
      metadata,
    });

    res.status(200).json({ question, answer });
  } catch (error: any) {
    logger.error({ error: error.message }, 'API Error: POST /api/ask-founder-ai');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- Manual Test Trigger Endpoints ---

/**
 * POST /api/trigger/digest
 * Force trigger WhatsApp messages digestion
 */
app.post('/api/trigger/digest', async (req, res) => {
  try {
    const result = await DigestService.processMessagesToDigests();
    res.status(200).json({ message: 'Digest job triggered successfully', result });
  } catch (error: any) {
    logger.error({ error: error.message }, 'API Error: POST /api/trigger/digest');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /api/trigger/email-sync
 * Force sync unread emails
 */
app.post('/api/trigger/email-sync', async (req, res) => {
  try {
    const count = await EmailService.syncEmails();
    res.status(200).json({ message: 'Email sync job completed', emailsSynced: count });
  } catch (error: any) {
    logger.error({ error: error.message }, 'API Error: POST /api/trigger/email-sync');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /api/trigger/briefing
 * Force generate morning briefing
 */
app.post('/api/trigger/briefing', async (req, res) => {
  try {
    const brief = await SchedulerService.generateAndSaveMorningBrief();
    res.status(200).json({ message: 'Morning briefing generated and saved', brief });
  } catch (error: any) {
    logger.error({ error: error.message }, 'API Error: POST /api/trigger/briefing');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /api/trigger/summary
 * Force generate daily evening summary
 */
app.post('/api/trigger/summary', async (req, res) => {
  try {
    const summary = await SchedulerService.generateAndSaveEveningSummary();
    res.status(200).json({ message: 'Evening summary generated and saved', summary });
  } catch (error: any) {
    logger.error({ error: error.message }, 'API Error: POST /api/trigger/summary');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- Boot Server & Start Cron Scheduler ---
async function startServer() {
  // Test connection to PostgreSQL at boot
  await checkDatabaseConnection();

  const port = config.PORT;
  app.listen(port, () => {
    logger.info(`🚀 Founder Assistant OS Server is running on http://localhost:${port} in ${config.NODE_ENV} mode`);

    // Start Background Scheduler
    SchedulerService.init();
  });
}

startServer().catch((err) => {
  logger.fatal({ error: err.message }, 'Failed to start Express server');
  process.exit(1);
});

export default app;
